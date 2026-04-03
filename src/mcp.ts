import cleanupPrompt from '@/prompts/correction.md'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { OpenRouter } from '@openrouter/sdk'
import type { ChatJsonSchemaConfig } from '@openrouter/sdk/models'
import { McpAgent } from 'agents/mcp'
import { type InferSelectModel } from 'drizzle-orm'
import {
	drizzle,
	type DrizzleSqliteDODatabase
} from 'drizzle-orm/durable-sqlite'
import { migrate } from 'drizzle-orm/durable-sqlite/migrator'
import { StatusCodes } from 'http-status-codes'
import { ms } from 'ms'
import { z } from 'zod'
import { version } from '../package.json'
import {
	baseUrl,
	PERSISTENT_ACCESS_TOKEN_REFRESH_WINDOW_MS,
	REPORTING_URL,
	USER_AGENT
} from './constants'
import migrations from './db/generated/migrations.js'
import { dataMetadata } from './db/schema'
import { FuelFinderOAuth } from './oauth'
import { patientFetch } from './patient_fetch.js'
import { parseJsonResponse } from './response'
import {
	OutputCorrectableStationDataArrayJSONSchema,
	type InputCorrectableStationData,
	type OutputCorrectableStationData
} from './types/CorrectableStationData.js'
import { DataRegion } from './types/DataRegion'
import type { FuelFinderStation } from './types/FuelFinderStation'

export class PetrolBabyObject extends McpAgent<Env> {
	override server = new McpServer({
		name: 'petrol-baby',
		version
	})

	private storage: DurableObjectStorage
	private db: DrizzleSqliteDODatabase<Record<string, unknown>>
	private oauth: FuelFinderOAuth

	private openrouterClient

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env)
		this.storage = ctx.storage
		this.db = drizzle(this.storage, { logger: false })
		this.oauth = new FuelFinderOAuth(this.db, env)
		this.openrouterClient = new OpenRouter({ apiKey: env.OPENROUTER_API_KEY })

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
			await this.backfillStations()
		}
		if (!pricesMetadata) {
			// await this.backfillPrices()
		}
	}

	private async cleanStationData(stations: FuelFinderStation[]) {
		console.log('ok. yay')
		const correctableData: InputCorrectableStationData[] = stations.map(
			(station) => ({
				nodeId: station.node_id,
				tradingName: station.trading_name,
				brandName: station.brand_name,
				phone: station.public_phone_number,
				isMotorwayServiceStation: station.is_motorway_service_station,
				isSupermarketServiceStation: station.is_supermarket_service_station,
				address: {
					address1: station.location.address_line_1,
					address2: station.location.address_line_2,
					city: station.location.city,
					county: station.location.county,
					country: station.location.country,
					postcode: station.location.postcode
				},
				coords: {
					latitude: station.location.latitude,
					longitude: station.location.longitude
				}
			})
		)
		const response = await this.openrouterClient.chat.send({
			httpReferer: 'https://fuel.baby/',
			appTitle: 'fuel.baby',
			chatRequest: {
				model: 'openai/gpt-5.4-mini',
				provider: {
					// requireParameters: true
				},
				messages: [
					{ role: 'system', content: cleanupPrompt },
					{ role: 'user', content: JSON.stringify(correctableData) }
				],
				responseFormat: {
					type: 'json_schema',
					jsonSchema:
						OutputCorrectableStationDataArrayJSONSchema as unknown as ChatJsonSchemaConfig
				},
				reasoning: { effort: 'none' },
				plugins: [{ id: 'response-healing' }]
			}
		})
		console.log('doing it')
		try {
			return JSON.parse(
				response.choices[0]?.message.content
			) as OutputCorrectableStationData
		} catch (e) {
			console.error(`Invalid output:`, response.choices[0]?.message.content)
			throw e
		}
	}

	private static OPENROUTER_BATCH_SIZE = 100

	private async fetchAllStations() {
		let page = 1
		const allStations: FuelFinderStation[] = []
		while (true) {
			await this.oauth.ensureAccessToken(
				PERSISTENT_ACCESS_TOKEN_REFRESH_WINDOW_MS
			)
			if (!this.oauth.accessToken) {
				return
			}
			const result = await patientFetch(
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
			allStations.push(...rawArr)
			page++
		}
		console.log(
			`Fetched ${allStations.length} stations across ${page - 1} pages`
		)
		return allStations
	}

	private async backfillStations() {
		const allStations = await this.fetchAllStations()
		if (!allStations) return

		const batches: FuelFinderStation[][] = []
		for (
			let i = 0;
			i < allStations.length;
			i += PetrolBabyObject.OPENROUTER_BATCH_SIZE
		) {
			batches.push(
				allStations.slice(i, i + PetrolBabyObject.OPENROUTER_BATCH_SIZE)
			)
		}
		console.log(
			`Cleaning ${allStations.length} stations in ${batches.length} batches of up to ${PetrolBabyObject.OPENROUTER_BATCH_SIZE}`
		)

		const cleanedStations = (
			await Promise.all(batches.map((batch) => this.cleanStationData(batch)))
		).flat()

		// TODO: Do something with our beautiful data

		console.log('Done!')
		console.log(JSON.stringify(cleanedStations))
	}

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
