import {
	and,
	eq,
	getTableColumns,
	inArray,
	isNull,
	lt,
	not,
	notExists,
	or,
	sql,
	type InferInsertModel,
	type InferSelectModel
} from 'drizzle-orm'
import { max } from 'drizzle-orm/sql/functions/aggregate'
import { ms } from 'ms'
import {
	detectDuplicates,
	detectDuplicatesForTargets,
	type DuplicateCandidate
} from './cleanup/duplicates'
import type { PreprocessedStation } from './cleanup/preprocess'
import type { ServerConfig } from './config'
import { MAX_SQLITE_VARS_PER_STATEMENT } from './constants'
import { AmenityNamer } from './data/amenity_namer'
import {
	StationInfoHelper,
	type CleanedStationRecord
} from './data/info_helper'
import { PriceInfoHelper, type BackfillPriceRecord } from './data/price_helper'
import { PriceQueryHelper } from './data/price_query_helper'
import { buildStationSlug } from './data/slug'
import { WebQueryHelper } from './data/web_query_helper'
import { openDatabase, verifyDatabase, type AppDatabase } from './db/client'
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
import { LiveHub } from './live'
import { FuelFinderOAuth } from './oauth'
import { DataRegion } from './types/DataRegion'
import { StationOpeningDay } from './types/StationOpeningDay'

const STATION_UPDATE_INTERVAL_MS = ms('15m')
const PRICE_UPDATE_INTERVAL_MS = ms('1m')
export const PRICING_EVENT_RETENTION_MS = ms('14d')
const PRUNE_INTERVAL_MS = ms('6h')
const SCHEDULER_TICK_MS = ms('1m')
const SLUG_BACKFILL_BATCH = 500
/** Amenities named per maintenance tick (one LLM call each, cached forever). */
const AMENITY_NAMING_BATCH = 8
/** Stations written to SQLite per backfill persist chunk (cleaning is done up front). */
const BACKFILL_PERSIST_CHUNK = 100

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

function chunk<T>(items: readonly T[], size: number): T[][] {
	const chunks: T[][] = []
	for (let i = 0; i < items.length; i += size) {
		chunks.push(items.slice(i, i + size))
	}
	return chunks
}

/**
 * The process-wide data service: owns the SQLite database, Fuel Finder
 * ingestion, retention, and all query helpers. Exactly one instance exists
 * per process. This replaces the Cloudflare Durable Object — MCP sessions
 * are now cheap per-request objects that borrow this service, instead of the
 * database living inside an MCP session object.
 */
export class PetrolBabyService {
	readonly config: ServerConfig
	readonly db: AppDatabase
	readonly live: LiveHub
	readonly priceQuery: PriceQueryHelper

	private readonly sqlite: import('bun:sqlite').Database
	private readonly oauth: FuelFinderOAuth
	private readonly stationInfoHelper: StationInfoHelper
	private readonly priceInfoHelper: PriceInfoHelper
	private readonly webQuery: WebQueryHelper
	private readonly amenityNamer: AmenityNamer

	private maintenancePromise: Promise<void> | null = null
	private maintenanceKind: MaintenanceKind | null = null
	private lastPrunedAt: number | null = null
	private schedulerTimer: ReturnType<typeof setInterval> | null = null
	private closed = false

	constructor(config: ServerConfig) {
		this.config = config
		const { db, sqlite } = openDatabase(config.databasePath)
		this.db = db
		this.sqlite = sqlite

		this.live = new LiveHub()
		this.oauth = new FuelFinderOAuth(this.db, config)
		this.priceQuery = new PriceQueryHelper(this.db)
		this.webQuery = new WebQueryHelper(this.db)
		this.amenityNamer = new AmenityNamer({ config })
		this.stationInfoHelper = new StationInfoHelper({
			config,
			oauth: this.oauth
		})
		this.priceInfoHelper = new PriceInfoHelper({
			config,
			oauth: this.oauth
		})
	}

	// ─── Health and readiness ────────────────────────────────────────────

	/** Cheap liveness probe: the database file is open and answering. */
	checkHealth(): boolean {
		const row = this.sqlite.query<{ one: number }, []>('SELECT 1 AS one').get()
		return row?.one === 1
	}

	/**
	 * Ready means both data regions have completed their initial backfill.
	 * Until then, station pages and MCP queries would return empty results.
	 */
	async isReady(): Promise<boolean> {
		const { stations, prices } = await this.readMetadataRows()
		return Boolean(stations && prices)
	}

	async ensurePriceQueryDataReady(): Promise<void> {
		if (!(await this.isReady())) {
			throw new Error(
				'Fuel data is still being backfilled. Try this query again shortly.'
			)
		}
	}

	private readMetadataRows = async () => {
		const metadata = await this.db.select().from(dataMetadata)
		return {
			stations: metadata.find((row) => row.region === DataRegion.Stations),
			prices: metadata.find((row) => row.region === DataRegion.Prices),
			prune: metadata.find((row) => row.region === DataRegion.Prune)
		}
	}

	// ─── Retention ───────────────────────────────────────────────────────

	/**
	 * Delete pricing events older than 14 days, unless the row is the latest
	 * event for its (nodeId, typeCode) grouping.
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

	/**
	 * Run {@link pruneOldPricingEvents} at most once per {@link PRUNE_INTERVAL_MS}.
	 * The cursor is persisted in `data_metadata` so the interval survives
	 * restarts and deploys; `lastPrunedAt` is just an in-memory fast path.
	 */
	private async maybePruneOldPricingEvents(prune: MetadataRow | undefined) {
		const now = Date.now()
		const persistedAt = prune?.lastUpdatedAt.getTime() ?? null
		const lastPrunedAt =
			persistedAt !== null && this.lastPrunedAt !== null
				? Math.max(persistedAt, this.lastPrunedAt)
				: (persistedAt ?? this.lastPrunedAt)

		if (lastPrunedAt !== null && now - lastPrunedAt < PRUNE_INTERVAL_MS) {
			return
		}

		await this.pruneOldPricingEvents()
		const prunedAt = new Date()
		this.lastPrunedAt = prunedAt.getTime()
		await this.markPruneComplete(prunedAt)
	}

	private async markPruneComplete(prunedAt: Date) {
		await this.db
			.insert(dataMetadata)
			.values({
				region: DataRegion.Prune,
				backfilledAt: prunedAt,
				lastUpdatedAt: prunedAt
			})
			.onConflictDoUpdate({
				target: dataMetadata.region,
				set: {
					lastUpdatedAt: prunedAt
				}
			})
	}

	// ─── Maintenance lock ────────────────────────────────────────────────

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

	/** Resolves once any in-flight maintenance settles (used on shutdown). */
	async waitForIdle(): Promise<void> {
		try {
			await this.maintenancePromise
		} catch {
			/* already logged by the runner */
		}
	}

	private isUpdateDue(lastUpdatedAt: Date, intervalMs: number): boolean {
		return Date.now() - lastUpdatedAt.getTime() >= intervalMs
	}

	// ─── Scheduled maintenance ───────────────────────────────────────────

	/**
	 * Best-effort cache backfills (slugs, amenity names) that must never break
	 * the core maintenance tick — a network/LLM hiccup shouldn't stop price
	 * updates or leave the scheduler throwing.
	 */
	private async runCacheBackfills() {
		try {
			await this.backfillMissingSlugs()
		} catch (error) {
			console.error('Slug backfill failed:', error)
		}
		try {
			await this.backfillAmenityDisplayNames()
		} catch (error) {
			console.error('Amenity naming failed:', error)
		}
	}

	private async runScheduledMaintenanceInternal() {
		const { stations, prices, prune } = await this.readMetadataRows()

		if (!stations || !prices) {
			// Unlike the Cloudflare deployment, the scheduler deliberately does
			// NOT start the initial backfill: it is a multi-hour job with real
			// OpenRouter cost and should only run as an explicit foreground
			// command. The service stays not-ready until it has been run.
			console.warn(
				'Station and/or price backfill incomplete. Run `bun run data:backfill` (packages/server) to populate the database.'
			)
			return
		}

		await this.maybePruneOldPricingEvents(prune)
		await this.runCacheBackfills()

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

	/**
	 * Start the once-a-minute maintenance loop plus one immediate background
	 * attempt (to catch up after downtime). Errors are logged, never thrown —
	 * the loop itself must survive any individual failure.
	 */
	startScheduler(): void {
		if (this.schedulerTimer || this.closed) return

		const tick = () => {
			this.runScheduledMaintenance().catch((error) =>
				console.error('scheduled maintenance failed:', error)
			)
		}

		this.schedulerTimer = setInterval(tick, SCHEDULER_TICK_MS)
		// The scheduler must never keep a shutting-down process alive.
		this.schedulerTimer.unref?.()
		tick()
	}

	stopScheduler(): void {
		if (this.schedulerTimer) {
			clearInterval(this.schedulerTimer)
			this.schedulerTimer = null
		}
	}

	/** Graceful shutdown: stop scheduling, close streams, close the DB. */
	async close(): Promise<void> {
		if (this.closed) return
		this.closed = true
		this.stopScheduler()
		this.live.close()
		await this.waitForIdle()
		this.sqlite.close(false)
	}

	/** Run SQLite integrity and foreign-key checks; throws on failure. */
	verify(): void {
		verifyDatabase(this.sqlite)
	}

	/**
	 * Take a consistent snapshot of the database using `VACUUM INTO`. The
	 * destination must not already exist.
	 */
	backupTo(destinationPath: string): void {
		this.sqlite.run('VACUUM INTO ?', [destinationPath])
	}

	// ─── Web page queries ────────────────────────────────────────────────

	public async getStationPage(slug: string) {
		return this.webQuery.getStationPage(slug)
	}

	public async getStationCompare(nodeId: string, fuelType: string) {
		return this.webQuery.getCompareDataByNodeId(nodeId, fuelType)
	}

	public async listStationsPage(options: {
		cursor: string | null
		query: string | null
		limit?: number
	}) {
		return this.webQuery.listStations(options)
	}

	public async listSitemapSlugs(cursor: string | null) {
		return this.webQuery.listSlugsForSitemap(cursor)
	}

	// ─── Known-code inserts ──────────────────────────────────────────────

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

	// ─── Pricing event inserts ───────────────────────────────────────────

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

	// ─── Station upserts and relations ───────────────────────────────────

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
				sourceHash: station.sourceHash,
				slug: buildStationSlug(station)
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

	// ─── Metadata cursors ────────────────────────────────────────────────

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

	// ─── Station cleaning pipeline ───────────────────────────────────────

	/**
	 * Compare preprocessed stations against persisted rows, re-clean only the
	 * missing/changed ones through the LLM, and return upsert-ready records.
	 * This hash reuse is what makes both incremental updates and interrupted
	 * backfills cheap to re-run.
	 */
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

	// ─── Backfills (foreground CLI only) ─────────────────────────────────

	/**
	 * Full station backfill. Stations are fetched once and cleaned in a single
	 * pass so every LLM batch fans out concurrently (see `cleanStations`),
	 * then the prepared rows are persisted to SQLite in chunks. Duplicate
	 * links are rebuilt from the database at the end.
	 */
	private async backfillStations() {
		const timeStarted = new Date()

		console.log('Backfilling stations')
		const preprocessed =
			await this.stationInfoHelper.fetchAllStationsPreprocessed()

		// Clean the entire set at once: all LLM batches run concurrently rather
		// than being throttled to one persist-chunk at a time.
		const records = await this.buildStationUpdateRecords(preprocessed)

		const chunks = chunk(records, BACKFILL_PERSIST_CHUNK)
		for (let i = 0; i < chunks.length; i++) {
			const part = chunks[i]
			if (!part) continue
			console.log(
				`Persisting station chunk ${i + 1}/${chunks.length} (${part.length} stations)...`
			)
			await this.upsertFuelStations(part, {
				onlyWhenSourceHashChanged: false
			})
			await this.deleteStationRelations(part.map((r) => r.nodeId))
			await this.insertStationRelations(part)
		}

		await this.rebuildPotentialDuplicates()
		await this.markBackfillComplete(DataRegion.Stations, timeStarted)
		console.log('Station backfill done.')
	}

	/** Recompute the potential-duplicate table from every persisted station. */
	private async rebuildPotentialDuplicates() {
		console.log('Rebuilding potential duplicate links...')
		const rows = await this.db
			.select({
				nodeId: fuelStation.nodeId,
				latitude: fuelStation.latitude,
				longitude: fuelStation.longitude,
				address1: fuelStation.address1,
				postcode: fuelStation.postcode,
				brandName: fuelStation.brandName
			})
			.from(fuelStation)

		const candidates: DuplicateCandidate[] = rows
			.filter(
				(row): row is typeof row & { latitude: number; longitude: number } =>
					row.latitude !== null && row.longitude !== null
			)
			.map((row) => ({
				nodeId: row.nodeId,
				latitude: row.latitude,
				longitude: row.longitude,
				address1: row.address1,
				postcode: row.postcode,
				brandName: row.brandName
			}))

		const duplicates = detectDuplicates(candidates)

		await this.db.delete(potentialDuplicate)

		const insertions: InferInsertModel<typeof potentialDuplicate>[] = []
		for (const [sourceNodeId, targets] of duplicates) {
			for (const targetNodeId of targets) {
				insertions.push({ sourceNodeId, targetNodeId })
			}
		}
		console.log(`Found ${duplicates.size} stations with potential duplicates`)

		const colCount = Object.keys(getTableColumns(potentialDuplicate)).length
		const batchSize = Math.floor(MAX_SQLITE_VARS_PER_STATEMENT / colCount)
		for (let i = 0; i < insertions.length; i += batchSize) {
			await this.db
				.insert(potentialDuplicate)
				.values(insertions.slice(i, i + batchSize))
				.onConflictDoNothing()
		}
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

	/**
	 * Backfill any missing data regions. This is the explicit foreground
	 * entrypoint used by `bun run data:backfill`; the scheduler never calls
	 * it on its own.
	 */
	public async runInitialBackfill(): Promise<void> {
		const promise = this.startMaintenance('backfill', async () => {
			const { stations, prices } = await this.readMetadataRows()
			if (!stations) {
				await this.backfillStations()
			} else {
				console.log('Stations already backfilled; skipping.')
			}
			if (!prices) {
				await this.backfillPrices()
			} else {
				console.log('Prices already backfilled; skipping.')
			}
		})
		if (!promise) {
			throw new Error('Another maintenance run is already active.')
		}
		await promise
	}

	// ─── Incremental updates ─────────────────────────────────────────────

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
		this.live.broadcast(priceInfo)
		await this.markUpdateComplete(DataRegion.Prices, timeStarted)
		console.log('Price update done.')
	}

	// ─── Cache backfills ─────────────────────────────────────────────────

	/**
	 * Populate the `slug` column for any stations that predate it. Cheap
	 * no-op once every row has a slug: the guard query stops after the first
	 * NULL.
	 */
	private async backfillMissingSlugs() {
		const pending = await this.db
			.select({
				nodeId: fuelStation.nodeId,
				tradingName: fuelStation.tradingName,
				brandName: fuelStation.brandName,
				city: fuelStation.city
			})
			.from(fuelStation)
			.where(isNull(fuelStation.slug))
			.limit(SLUG_BACKFILL_BATCH)

		if (pending.length === 0) {
			return
		}

		console.log(`Backfilling slugs for ${pending.length} stations...`)
		for (const station of pending) {
			await this.db
				.update(fuelStation)
				.set({ slug: buildStationSlug(station) })
				.where(eq(fuelStation.nodeId, station.nodeId))
		}
	}

	/**
	 * Give known amenity codes friendly display names, one LLM call per code,
	 * cached forever in `known_amenity.displayName`.
	 */
	private async backfillAmenityDisplayNames() {
		const pending = await this.db
			.select({ amenityCode: knownAmenity.amenityCode })
			.from(knownAmenity)
			.where(isNull(knownAmenity.displayName))
			.limit(AMENITY_NAMING_BATCH)

		if (pending.length === 0) {
			return
		}

		console.log(`Naming ${pending.length} amenities...`)
		for (const { amenityCode } of pending) {
			const displayName = await this.amenityNamer.nameOne(amenityCode)
			await this.db
				.update(knownAmenity)
				.set({ displayName })
				.where(eq(knownAmenity.amenityCode, amenityCode))
		}
	}
}
