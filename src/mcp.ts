import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { McpAgent } from 'agents/mcp'
import { z } from 'zod'
import { version } from '../package.json'
import {
	drizzle,
	type DrizzleSqliteDODatabase
} from 'drizzle-orm/durable-sqlite'
import { migrate } from 'drizzle-orm/durable-sqlite/migrator'
import migrations from '@/db/generated/migrations.js'
import { keys } from './db/schema'
import { KeyType } from './types/KeyType'

const BASE_URL = 'https://www.fuel-finder.service.gov.uk/api'

export class PetrolBabyObject extends McpAgent<Env> {
	server = new McpServer({
		name: 'petrol-baby',
		version
	})

	storage: DurableObjectStorage
	db: DrizzleSqliteDODatabase<Record<string, unknown>>

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env)
		this.storage = ctx.storage
		this.db = drizzle(this.storage, { logger: false })

		ctx.blockConcurrencyWhile(async () => {
			await migrate(this.db, migrations)
		})
		ctx.blockConcurrencyWhile(async () => {
			const retrievedKeys = await this.db.select().from(keys)
			if (
				!retrievedKeys.some(
					(retrievedKey) => retrievedKey.type === KeyType.Refresh
				)
			) {
				const generateResults:
					| { error: string }
					| { success: false; message: string }
					| {
							success: true
							data: {
								access_token: string
								token_type: string
								expires_in: number
								refresh_token: string
							}
							message: string
					  } = await (
					await fetch(BASE_URL + '/v1/oauth/generate_access_token', {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json'
						},
						body: JSON.stringify({
							client_id: env.FUEL_FINDER_CLIENT_ID,
							client_secret: env.FUEL_FINDER_CLIENT_SECRET
						})
					})
				).json()

				// We can't continue like this
				if (!('success' in generateResults))
					throw new Error(generateResults.error)
				if (!generateResults.success) throw new Error(generateResults.message)

				console.log(generateResults)
			}
		})
	}

	async init(): Promise<void> {
		const server = this.server as unknown as McpServer

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
