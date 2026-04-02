import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { McpAgent } from 'agents/mcp'
import { z } from 'zod'
import { version } from '../package.json'
import {
	drizzle,
	type DrizzleSqliteDODatabase
} from 'drizzle-orm/durable-sqlite'
import { migrate } from 'drizzle-orm/durable-sqlite/migrator'
import migrations from './db/generated/migrations.js'
import { FuelFinderOAuth } from './oauth'
import { dataMetadata } from './db/schema'
import {
	baseUrl,
	PERSISTENT_ACCESS_TOKEN_REFRESH_WINDOW_MS,
	REPORTING_URL,
	USER_AGENT
} from './constants'
import { StatusCodes } from 'http-status-codes'
import { ms } from 'ms'
import type { FuelFinderStation } from './types/FuelFinderStation.js'
import { parseJsonResponse } from './response'
import { DataRegion } from './types/DataRegion.js'
import { type InferSelectModel } from 'drizzle-orm'

export class PetrolBabyObject extends McpAgent<Env> {
	override server = new McpServer({
		name: 'petrol-baby',
		version
	})

	private storage: DurableObjectStorage
	private db: DrizzleSqliteDODatabase<Record<string, unknown>>
	private oauth: FuelFinderOAuth

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env)
		this.storage = ctx.storage
		this.db = drizzle(this.storage, { logger: false })
		this.oauth = new FuelFinderOAuth(this.db, env)

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
			await this.backfillAsNeeded(stationsMetadata, pricesMetadata)
		})
	}

	async backfillAsNeeded(
		stationsMetadata: InferSelectModel<typeof dataMetadata> | undefined,
		pricesMetadata: InferSelectModel<typeof dataMetadata> | undefined
	) {
		if (!stationsMetadata) {
			await this.backfillStations()
		}
		if (!pricesMetadata) {
			// await this.backfillPrices()
		}
	}

	async backfillStations() {
		let page = 1
		while (true) {
			await this.oauth.ensureAccessToken(
				PERSISTENT_ACCESS_TOKEN_REFRESH_WINDOW_MS
			)
			if (!this.oauth.accessToken) {
				return
			}
			const result = await fetch(
				baseUrl(this.env) + `/v1/pfs?batch-number=${page}`,
				{
					headers: {
						Accept: 'application/json',
						'Content-Type': 'application/json',
						'User-Agent': USER_AGENT,
						Authorization: `Bearer ${this.oauth.accessToken.value}`
					}
				}
			)
			if (result.status === StatusCodes.NOT_FOUND) {
				console.log('No more pages')
				break
			}
			if (result.status === StatusCodes.TOO_MANY_REQUESTS) {
				console.warn('Ratelimited!')
				console.debug(await result.text())
				// Professional ratelimit handling
				await new Promise((resolve) => setTimeout(resolve, ms('2s')))
				continue
			}
			if (!result.ok) {
				console.error(
					`Could not backfill stations: ${result.status} ${result.statusText}`
				)
				console.debug(await result.text())
				return
			}

			const rawArr = await parseJsonResponse<FuelFinderStation[]>(result, {
				context: `Fuel Finder stations batch ${page}`
			})

			// TODO: Do something with our beautiful data

			page++
		}
		console.log(`Station backfill done (stopped at page ${page - 1})`)
	}

	async init(): Promise<void> {
		const server = this.server as unknown as McpServer

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
