import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { McpAgent } from 'agents/mcp'
import {
	getTableColumns,
	sql,
	type InferInsertModel,
	type InferSelectModel
} from 'drizzle-orm'
import {
	drizzle,
	type DrizzleSqliteDODatabase
} from 'drizzle-orm/durable-sqlite'
import { migrate } from 'drizzle-orm/durable-sqlite/migrator'
import { z } from 'zod'
import { version } from '../package.json'
import { MAX_SQLITE_VARS_PER_STATEMENT, REPORTING_URL } from './constants'
import { StationInfoHelper } from './data/info_helper'
import { PriceInfoHelper } from './data/price_helper'
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
import { DataRegion } from './types/DataRegion'
import { StationOpeningDay } from './types/StationOpeningDay'

export class PetrolBabyObject extends McpAgent<Env> {
	override server = new McpServer({
		name: 'petrol-baby',
		version
	})

	private storage: DurableObjectStorage
	private db: DrizzleSqliteDODatabase<Record<string, unknown>>
	private oauth: FuelFinderOAuth
	private stationInfoHelper
	private priceInfoHelper

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env)
		this.storage = ctx.storage
		this.db = drizzle(this.storage, { logger: false })
		this.oauth = new FuelFinderOAuth(this.db, env)

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
			await this.oauth.initialize()

			const metadata = await this.db.select().from(dataMetadata)
			const stationsMetadata = metadata.find(
				(m) => m.region === DataRegion.Stations
			)
			const pricesMetadata = metadata.find(
				(m) => m.region === DataRegion.Prices
			)
			// Do not await
			this.backfillAsNeeded(stationsMetadata, pricesMetadata).catch((err) =>
				console.error('backfill failed:', err)
			)
		})
	}

	private async backfillAsNeeded(
		stationsMetadata: InferSelectModel<typeof dataMetadata> | undefined,
		pricesMetadata: InferSelectModel<typeof dataMetadata> | undefined
	) {
		if (!stationsMetadata) {
			await this.backfillStations()
		}
		if (!pricesMetadata) {
			await this.backfillPrices()
		}
	}

	private async backfillPrices() {
		// Important: We use the time that we *started* at because otherwise,
		// we may miss changes that happen in the window after we check but
		// before we commit the dataMetadata to db
		const timeStarted = new Date()

		console.log('Backfilling prices')
		const priceInfo = await this.priceInfoHelper.backfillPrices()

		// Known fuel types
		{
			const allFuelTypeCodes = [
				...new Set(priceInfo.map((price) => price.typeCode))
			]
			console.log(
				`Inserting ${allFuelTypeCodes.length} distinct price fuel type codes...`
			)
			const colCount = Object.keys(getTableColumns(knownType)).length
			const batchSize = MAX_SQLITE_VARS_PER_STATEMENT / colCount
			for (let i = 0; i < allFuelTypeCodes.length; i += batchSize) {
				const batch = allFuelTypeCodes.slice(i, i + batchSize)
				await this.db
					.insert(knownType)
					.values(batch.map((code) => ({ typeCode: code })))
					.onConflictDoNothing()
			}
		}

		// Pricing events
		{
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
				await this.db.insert(pricingEvent).values(batch).onConflictDoNothing()
			}
		}

		await this.db
			.insert(dataMetadata)
			.values({
				region: DataRegion.Prices,
				backfilledAt: timeStarted,
				lastUpdatedAt: timeStarted
			})
			.onConflictDoUpdate({
				target: dataMetadata.region,
				set: setAll(dataMetadata, { exclude: [dataMetadata.region] })
			})
		console.log('Price backfill done.')
	}

	private async backfillStations() {
		// Important: We use the time that we *started* at because otherwise,
		// we may miss changes that happen in the window after we check but
		// before we commit the dataMetadata to db
		const timeStarted = new Date()

		console.log('Backfilling stations')
		const stationInfo = await this.stationInfoHelper.backfillStations()

		// Stations
		{
			const colCount = Object.keys(getTableColumns(fuelStation)).length
			const batchSize = Math.floor(MAX_SQLITE_VARS_PER_STATEMENT / colCount)
			const totalBatches = Math.ceil(stationInfo.length / batchSize)
			for (let i = 0; i < stationInfo.length; i += batchSize) {
				const batchNum = Math.floor(i / batchSize) + 1
				if (batchNum % 50 === 1 || batchNum === totalBatches) {
					console.log(
						`Upserting stations: batch ${batchNum}/${totalBatches}...`
					)
				}
				const batch = stationInfo.slice(i, i + batchSize)
				await this.db
					.insert(fuelStation)
					.values(
						batch.map((station) => ({
							nodeId: station.nodeId,
							phone: station.phone,
							tradingName: station.tradingName,
							brandName: station.brandName,
							temporarilyClosed: station.temporarilyClosed,
							permanentlyClosed: station.permanentlyClosed,
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
							sourceHash: station.originalHash
						}))
					)
					.onConflictDoUpdate({
						target: fuelStation.nodeId,
						where: sql`${fuelStation.sourceHash} IS NOT ${sql.raw(`excluded.${fuelStation.sourceHash.name}`)}`,
						set: setAll(fuelStation, {
							exclude: [fuelStation.nodeId]
						})
					})
			}
		}

		// Known fuel types
		{
			const allFuelTypeCodes = [
				...new Set(stationInfo.flatMap((station) => station.fuelTypes))
			]
			console.log(
				`Inserting ${allFuelTypeCodes.length} distinct fuel type codes...`
			)
			const colCount = Object.keys(getTableColumns(knownType)).length
			const batchSize = MAX_SQLITE_VARS_PER_STATEMENT / colCount
			for (let i = 0; i < allFuelTypeCodes.length; i += batchSize) {
				const batch = allFuelTypeCodes.slice(i, i + batchSize)
				await this.db
					.insert(knownType)
					.values(batch.map((code) => ({ typeCode: code })))
					.onConflictDoNothing()
			}
		}

		// Fuel type associations
		{
			const typeInsertions = stationInfo.flatMap((station) =>
				station.fuelTypes.map(
					(typeCode): InferInsertModel<typeof availableFuelType> => ({
						nodeId: station.nodeId,
						typeCode
					})
				)
			)
			console.log(
				`Inserting ${typeInsertions.length} fuel type associations...`
			)
			const colCount = Object.keys(getTableColumns(availableFuelType)).length
			const batchSize = MAX_SQLITE_VARS_PER_STATEMENT / colCount
			for (let i = 0; i < typeInsertions.length; i += batchSize) {
				const batch = typeInsertions.slice(i, i + batchSize)
				await this.db
					.insert(availableFuelType)
					.values(batch)
					.onConflictDoNothing()
			}
		}

		// Known amenities
		{
			const allAmenities = [
				...new Set(stationInfo.flatMap((station) => station.amenities))
			]
			console.log(`Inserting ${allAmenities.length} distinct amenity codes...`)
			const colCount = Object.keys(getTableColumns(knownAmenity)).length
			const batchSize = MAX_SQLITE_VARS_PER_STATEMENT / colCount
			for (let i = 0; i < allAmenities.length; i += batchSize) {
				const batch = allAmenities.slice(i, i + batchSize)
				await this.db
					.insert(knownAmenity)
					.values(batch.map((code) => ({ amenityCode: code })))
					.onConflictDoNothing()
			}
		}

		// Amenity associations
		{
			const amenityInsertions = stationInfo.flatMap((station) =>
				station.amenities.map(
					(amenityCode): InferInsertModel<typeof stationAmenity> => ({
						nodeId: station.nodeId,
						amenityCode: amenityCode
					})
				)
			)
			console.log(
				`Inserting ${amenityInsertions.length} amenity associations...`
			)
			const colCount = Object.keys(getTableColumns(stationAmenity)).length
			const batchSize = MAX_SQLITE_VARS_PER_STATEMENT / colCount
			for (let i = 0; i < amenityInsertions.length; i += batchSize) {
				const batch = amenityInsertions.slice(i, i + batchSize)
				await this.db.insert(stationAmenity).values(batch).onConflictDoNothing()
			}
		}

		// Opening times
		{
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
			console.log(
				`Upserting ${openingTimeInsertions.length} opening time rows...`
			)
			const colCount = Object.keys(getTableColumns(stationOpeningTime)).length
			const batchSize = MAX_SQLITE_VARS_PER_STATEMENT / colCount
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

		// Potential duplicates
		{
			const duplicateAssociationInsertions = stationInfo
				.flatMap((station) =>
					station.potentialDuplicates?.map(
						(duplicateId): InferInsertModel<typeof potentialDuplicate> => ({
							sourceNodeId: station.nodeId,
							targetNodeId: duplicateId
						})
					)
				)
				.filter((item) => item !== undefined)
			console.log(
				`Inserting ${duplicateAssociationInsertions.length} potential duplicate associations...`
			)
			const colCount = Object.keys(getTableColumns(potentialDuplicate)).length
			const batchSize = MAX_SQLITE_VARS_PER_STATEMENT / colCount
			for (
				let i = 0;
				i < duplicateAssociationInsertions.length;
				i += batchSize
			) {
				const batch = duplicateAssociationInsertions.slice(i, i + batchSize)
				await this.db
					.insert(potentialDuplicate)
					.values(batch)
					.onConflictDoNothing()
			}
		}

		// Done!
		await this.db
			.insert(dataMetadata)
			.values({
				region: DataRegion.Stations,
				backfilledAt: timeStarted,
				lastUpdatedAt: timeStarted
			})
			.onConflictDoUpdate({
				target: dataMetadata.region,
				set: setAll(dataMetadata, { exclude: [dataMetadata.region] })
			})
		console.log('Station backfill done.')
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
			'oldest_stations_ever',
			{
				title: 'Oldest petrol stations ever',
				description:
					"Returns the first page of the fuel API results (maybe they're not really old)",
				inputSchema: {},
				outputSchema: {
					response: z.array(z.string())
				}
			},
			async () => {
				return {
					content: [
						{
							type: 'text',
							text: 'text'
						}
					],
					structuredContent: { response: ['My one! I own one, totally'] }
				}
			}
		)
	}
}
