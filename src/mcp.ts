import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { McpAgent } from 'agents/mcp'
import { getTableColumns, sql, type InferSelectModel } from 'drizzle-orm'
import {
	drizzle,
	type DrizzleSqliteDODatabase
} from 'drizzle-orm/durable-sqlite'
import { migrate } from 'drizzle-orm/durable-sqlite/migrator'
import { z } from 'zod'
import { version } from '../package.json'
import { MAX_SQLITE_VARS_PER_STATEMENT, REPORTING_URL } from './constants'
import { StationInfoHelper } from './data/info_helper'
import migrations from './db/generated/migrations.js'
import { setAll } from './db/helpers'
import { dataMetadata, fuelStation, knownType } from './db/schema'
import { FuelFinderOAuth } from './oauth'
import { DataRegion } from './types/DataRegion'

export class PetrolBabyObject extends McpAgent<Env> {
	override server = new McpServer({
		name: 'petrol-baby',
		version
	})

	private storage: DurableObjectStorage
	private db: DrizzleSqliteDODatabase<Record<string, unknown>>
	private oauth: FuelFinderOAuth
	private stationInfoHelper

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env)
		this.storage = ctx.storage
		this.db = drizzle(this.storage, { logger: false })
		this.oauth = new FuelFinderOAuth(this.db, env)

		this.stationInfoHelper = new StationInfoHelper({
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

	async backfillAsNeeded(
		stationsMetadata: InferSelectModel<typeof dataMetadata> | undefined,
		pricesMetadata: InferSelectModel<typeof dataMetadata> | undefined
	) {
		if (!stationsMetadata) {
			const stationInfo = await this.stationInfoHelper.backfillStations()

			// ── 1. Fuel stations ───────────────────────────────────────────

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
							batch.map((s) => ({
								nodeId: s.nodeId,
								phone: s.phone,
								tradingName: s.tradingName,
								brandName: s.brandName,
								temporarilyClosed: s.temporarilyClosed,
								permanentlyClosed: s.permanentlyClosed,
								isMotorwayService: s.isMotorwayServiceStation,
								isSupermarketService: s.isSupermarketServiceStation,
								address1: s.address1,
								address2: s.address2,
								city: s.city,
								country: s.country,
								postcode: s.postcode,
								latitude: s.latitude,
								longitude: s.longitude,
								permanentClosureDate: s.permanentClosureDate,
								coordinatesValid: s.coordinatesValid,
								sourceHash: s.originalHash
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

			// ── 2. Known fuel types (lookup table, insert-or-ignore) ───────

			{
				const allFuelTypeCodes = [
					...new Set(stationInfo.flatMap((s) => s.fuelTypes))
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
		}
		if (!pricesMetadata) {
			// await this.backfillPrices()
		}
	}

	// ─── MCP Server ────────────────────────────────────────────────────────

	async init(): Promise<void> {
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
