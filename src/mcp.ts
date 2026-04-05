import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { McpAgent } from 'agents/mcp'
import { type InferSelectModel } from 'drizzle-orm'
import {
	drizzle,
	type DrizzleSqliteDODatabase
} from 'drizzle-orm/durable-sqlite'
import { migrate } from 'drizzle-orm/durable-sqlite/migrator'
import { z } from 'zod'
import { version } from '../package.json'
import { REPORTING_URL } from './constants'
import migrations from './db/generated/migrations.js'
import { dataMetadata } from './db/schema'
import { FuelFinderOAuth } from './oauth'
import { StationDataHelper } from './station_data'
import { DataRegion } from './types/DataRegion'

export class PetrolBabyObject extends McpAgent<Env> {
	override server = new McpServer({
		name: 'petrol-baby',
		version
	})

	private storage: DurableObjectStorage
	private db: DrizzleSqliteDODatabase<Record<string, unknown>>
	private oauth: FuelFinderOAuth
	private stationDataHelper

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env)
		this.storage = ctx.storage
		this.db = drizzle(this.storage, { logger: false })
		this.oauth = new FuelFinderOAuth(this.db, env)

		this.stationDataHelper = new StationDataHelper({
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
			console.log(await this.stationDataHelper.backfillStations())
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
