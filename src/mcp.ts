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
import { fuelStation } from './db/schema'
import {
	baseUrl,
	INITIAL_ACCESS_TOKEN_REFRESH_WINDOW_MS,
	PERSISTENT_ACCESS_TOKEN_REFRESH_WINDOW_MS,
	REPORTING_URL,
	USER_AGENT
} from './constants'
import { StatusCodes } from 'http-status-codes'
import { ms } from 'ms'
import type { FuelFinderStation } from './types/FuelFinderStation.js'

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
			await this.oauth.initialize(INITIAL_ACCESS_TOKEN_REFRESH_WINDOW_MS)

			const backfillRequired =
				(await this.db.select().from(fuelStation).limit(1)).length === 0
			if (backfillRequired) this.backfill()
		})
	}

	async backfill() {
		// Stage 1: Backfill stations
		let page = 2
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

			const rawArr: FuelFinderStation[] = await result.json()
			console.log(rawArr)

			console.log(rawArr.length)
			// TODO: Not good enough logic -- there can be less than 500
			if (rawArr.length < 500) break
			page++
		}
		console.log(`Station backfill done (stopped at page ${page})`)
		// Stage 2: Backfill prices
	}

	async init(): Promise<void> {
		const server = this.server as unknown as McpServer

		server.registerTool(
			'issue_reporting_url',
			{
				title: 'Issue reporting URL',
				description:
					'Get the URL for reporting issues with data. Use this only if the user specifically says that data about fuel prices is incorrect.',
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
