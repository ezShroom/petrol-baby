import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { McpAgent } from 'agents/mcp'
import {
	and,
	eq,
	getTableColumns,
	inArray,
	lt,
	not,
	notExists,
	or,
	sql,
	type InferInsertModel,
	type InferSelectModel
} from 'drizzle-orm'
import {
	drizzle,
	type DrizzleSqliteDODatabase
} from 'drizzle-orm/durable-sqlite'
import { migrate } from 'drizzle-orm/durable-sqlite/migrator'
import { max } from 'drizzle-orm/sql/functions/aggregate'
import { ms } from 'ms'
import { z } from 'zod'
import { version } from '../package.json'
import {
	detectDuplicatesForTargets,
	type DuplicateCandidate
} from './cleanup/duplicates'
import type { PreprocessedStation } from './cleanup/preprocess'
import { MAX_SQLITE_VARS_PER_STATEMENT, REPORTING_URL } from './constants'
import {
	StationInfoHelper,
	type CleanedStationRecord,
	type StationRecordWithDuplicates
} from './data/info_helper'
import { PriceInfoHelper, type BackfillPriceRecord } from './data/price_helper'
import { PriceQueryHelper } from './data/price_query_helper'
import migrations from './db/generated/migrations.js'
import { setAll } from './db/helpers'
import {
	availableFuelType,
	dataMetadata,
	fuelStation,
	knownAmenity,
	knownType,
	potentialDuplicate,
	pricingEvent,
	stationAmenity,
	stationOpeningTime
} from './db/schema'
import { FuelFinderOAuth } from './oauth'
import { normalizePriceQuery } from './query/normalize_price_query'
import { buildListPricesText, buildSummaryText } from './query/price_query_text'
import { summarisePriceRows } from './query/price_summary'
import { DataRegion } from './types/DataRegion'
import { ListPricesOutputSchema } from './types/ListPricesOutput'
import { PriceQueryInputSchema } from './types/PriceQueryInput'
import { StationOpeningDay } from './types/StationOpeningDay'
import { SummarisePricesOutputSchema } from './types/SummarisePricesOutput'

const STATION_UPDATE_INTERVAL_MS = ms('15m')
const PRICE_UPDATE_INTERVAL_MS = ms('1m')
const PRICING_EVENT_RETENTION_MS = ms('14d')
const LIST_RESULTS_LIMIT = 20
const LIST_RESULTS_FETCH_LIMIT = LIST_RESULTS_LIMIT + 1

type MaintenanceKind = 'backfill' | 'scheduled'

type MetadataRow = InferSelectModel<typeof dataMetadata>

type StationUpsertRecord = Omit<CleanedStationRecord, 'originalHash'> & {
	sourceHash: string
	potentialDuplicates: string[] | null
}

type ExistingStationFields = Pick<
	InferSelectModel<typeof fuelStation>,
	| 'nodeId'
	| 'tradingName'
	| 'brandName'
	| 'address1'
	| 'address2'
	| 'city'
	| 'country'
	| 'postcode'
	| 'sourceHash'
>

function isForeignKeyConstraintError(error: unknown): boolean {
	if (!(error instanceof Error)) {
		return false
	}

	const messages = [error.message]
	if (error.cause instanceof Error) {
		messages.push(error.cause.message)
	}

	return messages.some((message) => {
		const normalized = message.toLowerCase()
		return (
			normalized.includes('foreign key constraint failed') ||
			(normalized.includes('constraint failed') &&
				normalized.includes('foreign key'))
		)
	})
}

function toStationUpsertRecord(
	station: StationRecordWithDuplicates
): StationUpsertRecord {
	return {
		nodeId: station.nodeId,
		tradingName: station.tradingName,
		brandName: station.brandName,
		phone: station.phone,
		isMotorwayServiceStation: station.isMotorwayServiceStation,
		isSupermarketServiceStation: station.isSupermarketServiceStation,
		address1: station.address1,
		address2: station.address2,
		city: station.city,
		country: station.country,
		postcode: station.postcode,
		latitude: station.latitude,
		longitude: station.longitude,
		coordinatesValid: station.coordinatesValid,
		amenities: station.amenities,
		openingTimes: station.openingTimes,
		fuelTypes: station.fuelTypes,
		temporarilyClosed: station.temporarilyClosed,
		permanentClosureDate: station.permanentClosureDate,
		sourceHash: station.originalHash,
		potentialDuplicates: station.potentialDuplicates
	}
}

export class PetrolBabyObject extends McpAgent<Env> {
	override server = new McpServer({
		name: 'petrol-baby',
		version
	})

	private db: DrizzleSqliteDODatabase<Record<string, unknown>>
	private oauth: FuelFinderOAuth
	private stationInfoHelper
	private priceInfoHelper
	private priceQueryHelper: PriceQueryHelper
	private maintenancePromise: Promise<void> | null = null
	private maintenanceKind: MaintenanceKind | null = null

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env)
		this.db = drizzle(ctx.storage, { logger: false })
		this.oauth = new FuelFinderOAuth(this.db, env)
		this.priceQueryHelper = new PriceQueryHelper(this.db)

		this.stationInfoHelper = new StationInfoHelper({
			env: this.env,
			oauth: this.oauth
		})
		this.priceInfoHelper = new PriceInfoHelper({
			env: this.env,
			oauth: this.oauth
		})

		ctx.blockConcurrencyWhile(async () => {
			await migrate(this.db, migrations)
			await this.pruneOldPricingEvents()
			await this.oauth.initialize()
		})
	}

	private readMetadataRows = async () => {
		const metadata = await this.db.select().from(dataMetadata)
		return {
			stations: metadata.find((row) => row.region === DataRegion.Stations),
			prices: metadata.find((row) => row.region === DataRegion.Prices)
		}
	}

	/**
	 * Delete pricing events older than 14 days, unless the row is the latest
	 * event for its (nodeId, typeCode) grouping.  Runs once at startup inside
	 * `blockConcurrencyWhile` so it cannot race with reads or writes.
	 */
	private async pruneOldPricingEvents() {
		const cutoff = new Date(Date.now() - PRICING_EVENT_RETENTION_MS)

		const latestPerGroup = this.db.$with('latest_per_group').as(
			this.db
				.select({
					nodeId: pricingEvent.nodeId,
					typeCode: pricingEvent.typeCode,
					latestTimestamp: max(pricingEvent.timestamp).as('latest_timestamp')
				})
				.from(pricingEvent)
				.groupBy(pricingEvent.nodeId, pricingEvent.typeCode)
		)

		await this.db
			.with(latestPerGroup)
			.delete(pricingEvent)
			.where(
				and(
					lt(pricingEvent.timestamp, cutoff),
					notExists(
						this.db
							.select({ n: sql`1` })
							.from(latestPerGroup)
							.where(
								and(
									eq(latestPerGroup.nodeId, pricingEvent.nodeId),
									eq(latestPerGroup.typeCode, pricingEvent.typeCode),
									eq(latestPerGroup.latestTimestamp, pricingEvent.timestamp)
								)
							)
					)
				)
			)

		console.log('Pruned old pricing events (>14 days, non-latest).')
	}

	private startMaintenance(
		kind: MaintenanceKind,
		runner: () => Promise<void>
	): Promise<void> | null {
		if (this.maintenancePromise) {
			console.log(
				`Skipping ${kind} maintenance; ${this.maintenanceKind ?? 'another'} run already active.`
			)
			return null
		}

		const promise = runner().finally(() => {
			if (this.maintenancePromise === promise) {
				this.maintenancePromise = null
				this.maintenanceKind = null
			}
		})

		this.maintenancePromise = promise
		this.maintenanceKind = kind
		return promise
	}

	private async backfillMissingRegions() {
		const { stations, prices } = await this.readMetadataRows()
		if (!stations) {
			await this.backfillStations()
		}
		if (!prices) {
			await this.backfillPrices()
		}
	}

	private isUpdateDue(lastUpdatedAt: Date, intervalMs: number): boolean {
		return Date.now() - lastUpdatedAt.getTime() >= intervalMs
	}

	private async runScheduledMaintenanceInternal() {
		const { stations, prices } = await this.readMetadataRows()

		if (!stations || !prices) {
			console.log(
				'Skipping scheduled maintenance until both station and price backfills complete.'
			)
			return
		}

		const shouldUpdateStations = this.isUpdateDue(
			stations.lastUpdatedAt,
			STATION_UPDATE_INTERVAL_MS
		)
		const shouldUpdatePrices = this.isUpdateDue(
			prices.lastUpdatedAt,
			PRICE_UPDATE_INTERVAL_MS
		)

		if (!shouldUpdateStations && !shouldUpdatePrices) {
			console.log('Skipping scheduled maintenance; nothing due.')
			return
		}

		if (shouldUpdateStations) {
			await this.updateStations(stations)
		}
		if (shouldUpdatePrices) {
			await this.updatePrices(prices)
		}
	}

	public async runScheduledMaintenance(): Promise<void> {
		const promise = this.startMaintenance('scheduled', () =>
			this.runScheduledMaintenanceInternal()
		)
		if (!promise) {
			return
		}

		await promise
	}

	private async insertKnownFuelTypes(typeCodes: string[]) {
		if (typeCodes.length === 0) {
			return
		}

		console.log(`Inserting ${typeCodes.length} distinct fuel type codes...`)
		const colCount = Object.keys(getTableColumns(knownType)).length
		const batchSize = Math.floor(MAX_SQLITE_VARS_PER_STATEMENT / colCount)
		for (let i = 0; i < typeCodes.length; i += batchSize) {
			const batch = typeCodes.slice(i, i + batchSize)
			await this.db
				.insert(knownType)
				.values(batch.map((code) => ({ typeCode: code })))
				.onConflictDoNothing()
		}
	}

	private async insertKnownAmenities(amenityCodes: string[]) {
		if (amenityCodes.length === 0) {
			return
		}

		console.log(`Inserting ${amenityCodes.length} distinct amenity codes...`)
		const colCount = Object.keys(getTableColumns(knownAmenity)).length
		const batchSize = Math.floor(MAX_SQLITE_VARS_PER_STATEMENT / colCount)
		for (let i = 0; i < amenityCodes.length; i += batchSize) {
			const batch = amenityCodes.slice(i, i + batchSize)
			await this.db
				.insert(knownAmenity)
				.values(batch.map((code) => ({ amenityCode: code })))
				.onConflictDoNothing()
		}
	}

	private async insertPricingEvents(priceInfo: BackfillPriceRecord[]) {
		if (priceInfo.length === 0) {
			return
		}

		console.log(`Inserting ${priceInfo.length} pricing events...`)
		const colCount = Object.keys(getTableColumns(pricingEvent)).length
		const batchSize = Math.floor(MAX_SQLITE_VARS_PER_STATEMENT / colCount)
		const totalBatches = Math.ceil(priceInfo.length / batchSize)
		for (let i = 0; i < priceInfo.length; i += batchSize) {
			const batchNum = Math.floor(i / batchSize) + 1
			if (batchNum % 50 === 1 || batchNum === totalBatches) {
				console.log(
					`Inserting pricing events: batch ${batchNum}/${totalBatches}...`
				)
			}
			const batch = priceInfo.slice(i, i + batchSize)
			await this.insertPricingBatch(batch, batchNum, totalBatches)
		}
	}

	private async insertPricingBatch(
		batch: BackfillPriceRecord[],
		batchNum: number,
		totalBatches: number
	) {
		try {
			await this.db.insert(pricingEvent).values(batch).onConflictDoNothing()
		} catch (error) {
			if (!isForeignKeyConstraintError(error)) {
				throw error
			}

			const distinctNodeIds = [...new Set(batch.map((row) => row.nodeId))]
			const knownStations = await this.db
				.select({ nodeId: fuelStation.nodeId })
				.from(fuelStation)
				.where(inArray(fuelStation.nodeId, distinctNodeIds))
			const knownNodeIds = new Set(
				knownStations.map((station) => station.nodeId)
			)
			const knownRows = batch.filter((row) => knownNodeIds.has(row.nodeId))
			const missingNodeIds = distinctNodeIds.filter(
				(nodeId) => !knownNodeIds.has(nodeId)
			)

			console.warn(
				`Pricing batch ${batchNum}/${totalBatches} hit missing stations; dropping ${missingNodeIds.length} node IDs and retrying ${knownRows.length}/${batch.length} rows.`
			)
			if (missingNodeIds.length > 0) {
				console.warn(
					`Missing station node IDs sample: ${missingNodeIds.slice(0, 10).join(', ')}`
				)
			}

			if (knownRows.length === 0) {
				return
			}

			await this.db.insert(pricingEvent).values(knownRows).onConflictDoNothing()
		}
	}

	private async upsertFuelStations(
		stationInfo: StationUpsertRecord[],
		options: { onlyWhenSourceHashChanged: boolean }
	) {
		if (stationInfo.length === 0) {
			return
		}

		const colCount = Object.keys(getTableColumns(fuelStation)).length
		const batchSize = Math.floor(MAX_SQLITE_VARS_PER_STATEMENT / colCount)
		const totalBatches = Math.ceil(stationInfo.length / batchSize)
		for (let i = 0; i < stationInfo.length; i += batchSize) {
			const batchNum = Math.floor(i / batchSize) + 1
			if (batchNum % 50 === 1 || batchNum === totalBatches) {
				console.log(`Upserting stations: batch ${batchNum}/${totalBatches}...`)
			}
			const batch = stationInfo.slice(i, i + batchSize)
			const values = batch.map((station) => ({
				nodeId: station.nodeId,
				phone: station.phone,
				tradingName: station.tradingName,
				brandName: station.brandName,
				temporarilyClosed: station.temporarilyClosed,
				isMotorwayService: station.isMotorwayServiceStation,
				isSupermarketService: station.isSupermarketServiceStation,
				address1: station.address1,
				address2: station.address2,
				city: station.city,
				country: station.country,
				postcode: station.postcode,
				latitude: station.latitude,
				longitude: station.longitude,
				permanentClosureDate: station.permanentClosureDate,
				coordinatesValid: station.coordinatesValid,
				sourceHash: station.sourceHash
			}))

			if (options.onlyWhenSourceHashChanged) {
				await this.db
					.insert(fuelStation)
					.values(values)
					.onConflictDoUpdate({
						target: fuelStation.nodeId,
						where: sql`${fuelStation.sourceHash} IS NOT ${sql.raw(`excluded.${fuelStation.sourceHash.name}`)}`,
						set: setAll(fuelStation, {
							exclude: [fuelStation.nodeId]
						})
					})
			} else {
				await this.db
					.insert(fuelStation)
					.values(values)
					.onConflictDoUpdate({
						target: fuelStation.nodeId,
						set: setAll(fuelStation, {
							exclude: [fuelStation.nodeId]
						})
					})
			}
		}
	}

	private async insertAvailableFuelTypes(stationInfo: StationUpsertRecord[]) {
		const typeInsertions = stationInfo.flatMap((station) =>
			station.fuelTypes.map(
				(typeCode): InferInsertModel<typeof availableFuelType> => ({
					nodeId: station.nodeId,
					typeCode
				})
			)
		)
		if (typeInsertions.length === 0) {
			return
		}

		console.log(`Inserting ${typeInsertions.length} fuel type associations...`)
		const colCount = Object.keys(getTableColumns(availableFuelType)).length
		const batchSize = Math.floor(MAX_SQLITE_VARS_PER_STATEMENT / colCount)
		for (let i = 0; i < typeInsertions.length; i += batchSize) {
			const batch = typeInsertions.slice(i, i + batchSize)
			await this.db
				.insert(availableFuelType)
				.values(batch)
				.onConflictDoNothing()
		}
	}

	private async insertStationAmenities(stationInfo: StationUpsertRecord[]) {
		const amenityInsertions = stationInfo.flatMap((station) =>
			station.amenities.map(
				(amenityCode): InferInsertModel<typeof stationAmenity> => ({
					nodeId: station.nodeId,
					amenityCode
				})
			)
		)
		if (amenityInsertions.length === 0) {
			return
		}

		console.log(`Inserting ${amenityInsertions.length} amenity associations...`)
		const colCount = Object.keys(getTableColumns(stationAmenity)).length
		const batchSize = Math.floor(MAX_SQLITE_VARS_PER_STATEMENT / colCount)
		for (let i = 0; i < amenityInsertions.length; i += batchSize) {
			const batch = amenityInsertions.slice(i, i + batchSize)
			await this.db.insert(stationAmenity).values(batch).onConflictDoNothing()
		}
	}

	private async insertStationOpeningTimes(stationInfo: StationUpsertRecord[]) {
		const usualDayMappings = [
			[StationOpeningDay.Monday, 'monday'],
			[StationOpeningDay.Tuesday, 'tuesday'],
			[StationOpeningDay.Wednesday, 'wednesday'],
			[StationOpeningDay.Thursday, 'thursday'],
			[StationOpeningDay.Friday, 'friday'],
			[StationOpeningDay.Saturday, 'saturday'],
			[StationOpeningDay.Sunday, 'sunday']
		] as const

		const openingTimeInsertions = stationInfo.flatMap((station) => [
			...usualDayMappings.map(([day, key]) => {
				const times = station.openingTimes.usual_days[key]
				return {
					nodeId: station.nodeId,
					day,
					openTime: times.open,
					closeTime: times.close,
					is24Hours: times.is_24_hours
				}
			}),
			{
				nodeId: station.nodeId,
				day: StationOpeningDay.BankHoliday,
				openTime: station.openingTimes.bank_holiday.open_time,
				closeTime: station.openingTimes.bank_holiday.close_time,
				is24Hours: station.openingTimes.bank_holiday.is_24_hours
			}
		])
		if (openingTimeInsertions.length === 0) {
			return
		}

		console.log(
			`Upserting ${openingTimeInsertions.length} opening time rows...`
		)
		const colCount = Object.keys(getTableColumns(stationOpeningTime)).length
		const batchSize = Math.floor(MAX_SQLITE_VARS_PER_STATEMENT / colCount)
		for (let i = 0; i < openingTimeInsertions.length; i += batchSize) {
			const batch = openingTimeInsertions.slice(i, i + batchSize)
			await this.db
				.insert(stationOpeningTime)
				.values(batch)
				.onConflictDoUpdate({
					target: [stationOpeningTime.nodeId, stationOpeningTime.day],
					set: setAll(stationOpeningTime, {
						exclude: [stationOpeningTime.nodeId, stationOpeningTime.day]
					})
				})
		}
	}

	private async insertPotentialDuplicates(stationInfo: StationUpsertRecord[]) {
		const duplicateAssociationInsertions = stationInfo
			.flatMap((station) =>
				station.potentialDuplicates?.map(
					(targetNodeId): InferInsertModel<typeof potentialDuplicate> => ({
						sourceNodeId: station.nodeId,
						targetNodeId
					})
				)
			)
			.filter((item) => item !== undefined)
		if (duplicateAssociationInsertions.length === 0) {
			return
		}

		console.log(
			`Inserting ${duplicateAssociationInsertions.length} potential duplicate associations...`
		)
		const colCount = Object.keys(getTableColumns(potentialDuplicate)).length
		const batchSize = Math.floor(MAX_SQLITE_VARS_PER_STATEMENT / colCount)
		for (let i = 0; i < duplicateAssociationInsertions.length; i += batchSize) {
			const batch = duplicateAssociationInsertions.slice(i, i + batchSize)
			await this.db
				.insert(potentialDuplicate)
				.values(batch)
				.onConflictDoNothing()
		}
	}

	private async insertStationRelations(stationInfo: StationUpsertRecord[]) {
		const allFuelTypeCodes = [
			...new Set(stationInfo.flatMap((s) => s.fuelTypes))
		]
		await this.insertKnownFuelTypes(allFuelTypeCodes)

		const allAmenities = [...new Set(stationInfo.flatMap((s) => s.amenities))]
		await this.insertKnownAmenities(allAmenities)

		await this.insertAvailableFuelTypes(stationInfo)
		await this.insertStationAmenities(stationInfo)
		await this.insertStationOpeningTimes(stationInfo)
		await this.insertPotentialDuplicates(stationInfo)
	}

	private async deleteStationRelations(nodeIds: string[]) {
		if (nodeIds.length === 0) {
			return
		}

		await this.db
			.delete(availableFuelType)
			.where(inArray(availableFuelType.nodeId, nodeIds))
		await this.db
			.delete(stationAmenity)
			.where(inArray(stationAmenity.nodeId, nodeIds))
		await this.db
			.delete(stationOpeningTime)
			.where(inArray(stationOpeningTime.nodeId, nodeIds))
		await this.db
			.delete(potentialDuplicate)
			.where(
				or(
					inArray(potentialDuplicate.sourceNodeId, nodeIds),
					inArray(potentialDuplicate.targetNodeId, nodeIds)
				)
			)
	}

	private async markBackfillComplete(region: DataRegion, timeStarted: Date) {
		await this.db
			.insert(dataMetadata)
			.values({
				region,
				backfilledAt: timeStarted,
				lastUpdatedAt: timeStarted
			})
			.onConflictDoUpdate({
				target: dataMetadata.region,
				set: {
					backfilledAt: timeStarted,
					lastUpdatedAt: timeStarted
				}
			})
	}

	private async markUpdateComplete(region: DataRegion, timeStarted: Date) {
		await this.db
			.insert(dataMetadata)
			.values({
				region,
				backfilledAt: timeStarted,
				lastUpdatedAt: timeStarted
			})
			.onConflictDoUpdate({
				target: dataMetadata.region,
				set: {
					lastUpdatedAt: timeStarted
				}
			})
	}

	private async buildStationUpdateRecords(
		preprocessed: PreprocessedStation[]
	): Promise<StationUpsertRecord[]> {
		if (preprocessed.length === 0) {
			return []
		}

		const nodeIds = [...new Set(preprocessed.map((station) => station.nodeId))]
		const existingStations = await this.db
			.select({
				nodeId: fuelStation.nodeId,
				tradingName: fuelStation.tradingName,
				brandName: fuelStation.brandName,
				address1: fuelStation.address1,
				address2: fuelStation.address2,
				city: fuelStation.city,
				country: fuelStation.country,
				postcode: fuelStation.postcode,
				sourceHash: fuelStation.sourceHash
			})
			.from(fuelStation)
			.where(inArray(fuelStation.nodeId, nodeIds))

		const existingById = new Map<string, ExistingStationFields>(
			existingStations.map((station) => [station.nodeId, station])
		)

		const reusedById = new Map<string, StationUpsertRecord>()
		const stationsToClean: PreprocessedStation[] = []

		for (const station of preprocessed) {
			const existing = existingById.get(station.nodeId)
			if (!existing || existing.sourceHash !== station.originalHash) {
				stationsToClean.push(station)
				continue
			}

			reusedById.set(station.nodeId, {
				nodeId: station.nodeId,
				tradingName: existing.tradingName ?? station.tradingName,
				brandName: existing.brandName ?? station.brandName,
				phone: station.phone,
				isMotorwayServiceStation: station.isMotorwayServiceStation,
				isSupermarketServiceStation: station.isSupermarketServiceStation,
				address1: existing.address1,
				address2: existing.address2,
				city: existing.city,
				country: existing.country,
				postcode: existing.postcode,
				latitude: station.coords.latitude,
				longitude: station.coords.longitude,
				coordinatesValid: station.coords.valid,
				amenities: station.amenities,
				openingTimes: station.openingTimes,
				fuelTypes: station.fuelTypes,
				temporarilyClosed: station.temporarilyClosed,
				permanentClosureDate: station.permanentClosureDate,
				sourceHash: station.originalHash,
				potentialDuplicates: null
			})
		}

		const cleanedById = new Map<string, StationUpsertRecord>()
		if (stationsToClean.length > 0) {
			console.log(
				`Re-running station cleaning for ${stationsToClean.length}/${preprocessed.length} changed station rows...`
			)
			const cleanedStations =
				await this.stationInfoHelper.cleanStations(stationsToClean)
			for (const station of cleanedStations) {
				cleanedById.set(station.nodeId, {
					nodeId: station.nodeId,
					tradingName: station.tradingName,
					brandName: station.brandName,
					phone: station.phone,
					isMotorwayServiceStation: station.isMotorwayServiceStation,
					isSupermarketServiceStation: station.isSupermarketServiceStation,
					address1: station.address1,
					address2: station.address2,
					city: station.city,
					country: station.country,
					postcode: station.postcode,
					latitude: station.latitude,
					longitude: station.longitude,
					coordinatesValid: station.coordinatesValid,
					amenities: station.amenities,
					openingTimes: station.openingTimes,
					fuelTypes: station.fuelTypes,
					temporarilyClosed: station.temporarilyClosed,
					permanentClosureDate: station.permanentClosureDate,
					sourceHash: station.originalHash,
					potentialDuplicates: null
				})
			}
		}

		const stationInfo = preprocessed.map((station) => {
			const reused = reusedById.get(station.nodeId)
			if (reused) {
				return reused
			}

			const cleaned = cleanedById.get(station.nodeId)
			if (!cleaned) {
				throw new Error(`Missing prepared station row for ${station.nodeId}`)
			}

			return cleaned
		})

		return this.attachPotentialDuplicates(stationInfo)
	}

	private async attachPotentialDuplicates(
		stationInfo: StationUpsertRecord[]
	): Promise<StationUpsertRecord[]> {
		if (stationInfo.length === 0) {
			return []
		}

		const changedNodeIds = stationInfo.map((station) => station.nodeId)
		const postcodes = [
			...new Set(
				stationInfo
					.map((station) => station.postcode)
					.filter((postcode): postcode is string => Boolean(postcode))
			)
		]
		const brandNames = [
			...new Set(
				stationInfo
					.map((station) => station.brandName)
					.filter((brandName): brandName is string => Boolean(brandName))
			)
		]

		const targetCandidates: DuplicateCandidate[] = stationInfo.map(
			(station) => ({
				nodeId: station.nodeId,
				latitude: station.latitude,
				longitude: station.longitude,
				address1: station.address1,
				postcode: station.postcode,
				brandName: station.brandName
			})
		)

		const candidateConditions = []
		if (postcodes.length > 0) {
			candidateConditions.push(inArray(fuelStation.postcode, postcodes))
		}
		if (brandNames.length > 0) {
			candidateConditions.push(inArray(fuelStation.brandName, brandNames))
		}

		const existingCandidates =
			candidateConditions.length === 0
				? []
				: await this.db
						.select({
							nodeId: fuelStation.nodeId,
							latitude: fuelStation.latitude,
							longitude: fuelStation.longitude,
							address1: fuelStation.address1,
							postcode: fuelStation.postcode,
							brandName: fuelStation.brandName
						})
						.from(fuelStation)
						.where(
							and(
								not(inArray(fuelStation.nodeId, changedNodeIds)),
								or(...candidateConditions)
							)
						)

		const narrowedExistingCandidates: DuplicateCandidate[] = existingCandidates
			.filter(
				(
					candidate
				): candidate is typeof candidate & {
					latitude: number
					longitude: number
				} => candidate.latitude !== null && candidate.longitude !== null
			)
			.map((candidate) => ({
				nodeId: candidate.nodeId,
				latitude: candidate.latitude,
				longitude: candidate.longitude,
				address1: candidate.address1,
				postcode: candidate.postcode,
				brandName: candidate.brandName
			}))

		const duplicates = detectDuplicatesForTargets(targetCandidates, [
			...targetCandidates,
			...narrowedExistingCandidates
		])

		return stationInfo.map((station) => ({
			...station,
			potentialDuplicates: duplicates.get(station.nodeId) ?? null
		}))
	}

	private async backfillPrices() {
		const timeStarted = new Date()

		console.log('Backfilling prices')
		const priceInfo = await this.priceInfoHelper.backfillPrices()
		await this.insertKnownFuelTypes([
			...new Set(priceInfo.map((price) => price.typeCode))
		])
		await this.insertPricingEvents(priceInfo)
		await this.markBackfillComplete(DataRegion.Prices, timeStarted)
		console.log('Price backfill done.')
	}

	private async backfillStations() {
		const timeStarted = new Date()

		console.log('Backfilling stations')
		const stationInfo = (await this.stationInfoHelper.backfillStations()).map(
			toStationUpsertRecord
		)
		await this.upsertFuelStations(stationInfo, {
			onlyWhenSourceHashChanged: true
		})
		await this.insertStationRelations(stationInfo)
		await this.markBackfillComplete(DataRegion.Stations, timeStarted)
		console.log('Station backfill done.')
	}

	private async updateStations(metadata: MetadataRow) {
		const timeStarted = new Date()

		console.log('Updating stations')
		const preprocessed = await this.stationInfoHelper.fetchIncrementalStations(
			metadata.lastUpdatedAt
		)
		if (preprocessed.length === 0) {
			console.log('No station changes returned from incremental endpoint.')
			await this.markUpdateComplete(DataRegion.Stations, timeStarted)
			return
		}

		const stationInfo = await this.buildStationUpdateRecords(preprocessed)
		await this.upsertFuelStations(stationInfo, {
			onlyWhenSourceHashChanged: false
		})
		await this.deleteStationRelations(
			stationInfo.map((station) => station.nodeId)
		)
		await this.insertStationRelations(stationInfo)
		await this.markUpdateComplete(DataRegion.Stations, timeStarted)
		console.log('Station update done.')
	}

	private async updatePrices(metadata: MetadataRow) {
		const timeStarted = new Date()

		console.log('Updating prices')
		const priceInfo = await this.priceInfoHelper.fetchIncrementalPrices(
			metadata.lastUpdatedAt
		)
		await this.insertKnownFuelTypes([
			...new Set(priceInfo.map((price) => price.typeCode))
		])
		await this.insertPricingEvents(priceInfo)
		await this.markUpdateComplete(DataRegion.Prices, timeStarted)
		console.log('Price update done.')
	}

	private async ensurePriceQueryDataReady() {
		const { stations, prices } = await this.readMetadataRows()
		if (!stations || !prices) {
			throw new Error(
				'Fuel data is still being backfilled. Try this query again shortly.'
			)
		}
	}

	// ─── MCP Server ────────────────────────────────────────────────────────

	override async init(): Promise<void> {
		const server = this.server

		server.registerTool(
			'issue_reporting_url',
			{
				title: 'Issue reporting URL',
				description:
					'Get the URL for reporting issues with data. Use this only if the user specifically says that data returned from fuel.baby is incorrect or outdated.',
				outputSchema: {
					url: z.url()
				}
			},
			async () => ({
				content: [
					{
						type: 'text',
						text: REPORTING_URL
					}
				],
				structuredContent: {
					url: REPORTING_URL
				}
			})
		)
		server.registerTool(
			'known_fuel_types',
			{
				title: 'Known fuel types',
				description:
					'Return the currently known fuel type codes that can be used in fuel price queries.',
				outputSchema: z.object({
					fuelTypes: z.array(z.string())
				})
			},
			async () => {
				const fuelTypes =
					await this.priceQueryHelper.listKnownCodes('known_type')
				return {
					content: [
						{
							type: 'text',
							text:
								fuelTypes.length === 0
									? 'No known fuel types have been loaded yet.'
									: `Known fuel types: ${fuelTypes.join(', ')}`
						}
					],
					structuredContent: { fuelTypes }
				}
			}
		)
		server.registerTool(
			'known_amenities',
			{
				title: 'Known amenities',
				description:
					'Return the currently known amenity codes that can be used as station filters.',
				outputSchema: z.object({
					amenities: z.array(z.string())
				})
			},
			async () => {
				const amenities =
					await this.priceQueryHelper.listKnownCodes('known_amenity')
				return {
					content: [
						{
							type: 'text',
							text:
								amenities.length === 0
									? 'No known amenities have been loaded yet.'
									: `Known amenities: ${amenities.join(', ')}`
						}
					],
					structuredContent: { amenities }
				}
			}
		)
		server.registerTool(
			'list_prices',
			{
				title: 'List fuel prices',
				description:
					'Find actual stations and their current price for one fuel type. Returns up to 20 stations, sorted cheapest first, and clearly flags when more stations matched. If the list is truncated, use summarise_prices to work with larger matching sets.',
				inputSchema: PriceQueryInputSchema,
				outputSchema: ListPricesOutputSchema
			},
			async (input) => {
				await this.ensurePriceQueryDataReady()
				const query = normalizePriceQuery(input)
				const baseRows = await this.priceQueryHelper.queryCurrentPriceRows(
					query,
					LIST_RESULTS_FETCH_LIMIT
				)
				const isTruncated = baseRows.length > LIST_RESULTS_LIMIT
				const hydratedRows =
					await this.priceQueryHelper.hydrateStationPriceRows(
						query,
						baseRows.slice(0, LIST_RESULTS_LIMIT)
					)
				const result: z.infer<typeof ListPricesOutputSchema> = {
					query,
					items: hydratedRows,
					returnedCount: hydratedRows.length,
					isTruncated,
					truncationMessage: isTruncated
						? 'More than 20 stations matched this query, so only the first 20 cheapest results are included. Use summarise_prices if you need to work across the full matching set.'
						: null,
					matchedCountLowerBound: isTruncated
						? LIST_RESULTS_FETCH_LIMIT
						: hydratedRows.length,
					sort: 'price_ascending'
				}

				return {
					content: [
						{
							type: 'text',
							text: buildListPricesText(result)
						}
					],
					structuredContent: result
				}
			}
		)
		server.registerTool(
			'summarise_prices',
			{
				title: 'Summarise fuel prices',
				description:
					'Summarise the current prices for the same query model as list_prices. Returns min, max, mean, quartiles, and median, with real stations attached to the highlighted observed prices. Use highlightSampleSize to ask for a fuzzier set of nearby stations around each highlighted point.',
				inputSchema: PriceQueryInputSchema,
				outputSchema: SummarisePricesOutputSchema
			},
			async (input) => {
				await this.ensurePriceQueryDataReady()
				const query = normalizePriceQuery(input)
				const baseRows =
					await this.priceQueryHelper.queryCurrentPriceRows(query)
				const hydratedRows =
					await this.priceQueryHelper.hydrateStationPriceRows(query, baseRows)
				const result = summarisePriceRows(query, hydratedRows)

				return {
					content: [
						{
							type: 'text',
							text: buildSummaryText(result)
						}
					],
					structuredContent: result
				}
			}
		)

		const promise = this.startMaintenance('backfill', () =>
			this.backfillMissingRegions()
		)
		if (promise) {
			promise.catch((error) => console.error('backfill failed:', error))
		}
	}
}
