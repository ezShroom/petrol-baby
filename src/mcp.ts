import addressPrompt from '@/prompts/addresses.md'
import namesPrompt from '@/prompts/names.md'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { OpenRouter } from '@openrouter/sdk'
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
import { detectDuplicates, type DuplicateCandidate } from './cleanup/duplicates'
import { createIdMapping, restoreId, type IdMapping } from './cleanup/idmap'
import { preprocess, type PreprocessedStation } from './cleanup/preprocess'
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
	AddressCorrectionOutputArrayJSONSchema,
	AddressCorrectionOutputSchema,
	NameCorrectionOutputArrayJSONSchema,
	NameCorrectionOutputSchema,
	type AddressCorrectionInput,
	type AddressCorrectionOutput,
	type NameCorrectionInput,
	type NameCorrectionOutput
} from './types/CorrectableStationData.js'
import { DataRegion } from './types/DataRegion'
import type { FuelFinderStation } from './types/FuelFinderStation'

/** Batch size for LLM calls — smaller = more focused attention per station */
const LLM_BATCH_SIZE = 25

/** Maximum retries per LLM call before hard failure */
const MAX_LLM_RETRIES = 5

/** Timeout per individual LLM request */
const LLM_TIMEOUT_MS = ms('90s')

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

	// ─── LLM Call Helpers ──────────────────────────────────────────────────

	/**
	 * Calls the LLM for name correction (Pass 1).
	 * Returns validated output or throws after MAX_LLM_RETRIES failures.
	 */
	private async correctNames(
		input: NameCorrectionInput[]
	): Promise<NameCorrectionOutput[]> {
		return this.callLLMWithRetry({
			prompt: namesPrompt,
			input,
			jsonSchema: NameCorrectionOutputArrayJSONSchema,
			outputSchema: NameCorrectionOutputSchema,
			passName: 'name correction'
		})
	}

	/**
	 * Calls the LLM for address correction (Pass 2).
	 * Returns validated output or throws after MAX_LLM_RETRIES failures.
	 */
	private async correctAddresses(
		input: AddressCorrectionInput[]
	): Promise<AddressCorrectionOutput[]> {
		return this.callLLMWithRetry({
			prompt: addressPrompt,
			input,
			jsonSchema: AddressCorrectionOutputArrayJSONSchema,
			outputSchema: AddressCorrectionOutputSchema,
			passName: 'address correction'
		})
	}

	/**
	 * Generic LLM call with structured output, Zod validation, station count
	 * verification, and retry logic. Retries up to MAX_LLM_RETRIES times,
	 * then throws a loud error.
	 */
	/**
	 * Deep-clones a JSON schema and sets minItems/maxItems on the
	 * `stations` array property to match the expected batch size.
	 */
	private static withArrayBounds(
		schema: Record<string, unknown>,
		count: number
	): Record<string, unknown> {
		const cloned = JSON.parse(JSON.stringify(schema)) as Record<string, unknown>
		const props = (cloned as Record<string, Record<string, unknown>>)[
			'properties'
		]
		if (props?.['stations'] && typeof props['stations'] === 'object') {
			const stations = props['stations'] as Record<string, unknown>
			stations['minItems'] = count
			stations['maxItems'] = count
		}
		return cloned
	}

	private async callLLMWithRetry<TInput, TOutput extends { id: number }>({
		prompt,
		input,
		jsonSchema,
		outputSchema,
		passName
	}: {
		prompt: string
		input: TInput[]
		jsonSchema: Record<string, unknown>
		outputSchema: z.ZodType<TOutput>
		passName: string
	}): Promise<TOutput[]> {
		const expectedCount = input.length
		const boundedSchema = PetrolBabyObject.withArrayBounds(
			jsonSchema,
			expectedCount
		)

		for (let attempt = 1; attempt <= MAX_LLM_RETRIES; attempt++) {
			try {
				const response = await this.openrouterClient.chat.send(
					{
						httpReferer: 'https://petrol.baby/',
						appTitle: 'petrol.baby',
						chatRequest: {
							model: 'gpt-5.4',
							messages: [
								{ role: 'system', content: prompt },
								{ role: 'system', content: prompt },
								{ role: 'user', content: JSON.stringify(input) }
							],
							responseFormat: {
								type: 'json_schema',
								jsonSchema: {
									name: 'cleanedData',
									strict: true,
									schema: boundedSchema
								}
							},
							reasoning: { effort: 'none' },
							plugins: [{ id: 'response-healing' }]
						}
					},
					{ timeoutMs: LLM_TIMEOUT_MS }
				)

				const rawContent = response.choices[0]?.message.content
				if (!rawContent) {
					throw new Error(`Empty response from LLM on ${passName}`)
				}

				const parsed = JSON.parse(rawContent) as { stations: unknown[] }
				if (!Array.isArray(parsed.stations)) {
					throw new Error(
						`LLM response for ${passName} missing 'stations' array`
					)
				}

				// Validate station count
				if (parsed.stations.length !== expectedCount) {
					throw new Error(
						`${passName}: expected ${expectedCount} stations, got ${parsed.stations.length}`
					)
				}

				// Sanitise: convert empty strings and JSON-fragment garbage to null.
				// Models sometimes leak syntax like ":null,", ",", "null" etc.
				// instead of producing an actual null value. Catch anything that
				// is empty, looks like leaked JSON punctuation, or is a stringified
				// null variant.
				const isGarbageNull = (v: string): boolean =>
					v === '' || /^[\s:,"{}[\]null]*$/.test(v)
				for (const station of parsed.stations) {
					if (typeof station === 'object' && station !== null) {
						const record = station as Record<string, unknown>
						for (const [key, value] of Object.entries(record)) {
							if (typeof value === 'string' && isGarbageNull(value)) {
								record[key] = null
							}
						}
					}
				}

				// Validate each station against the Zod schema
				const validated: TOutput[] = []
				const errors: string[] = []

				for (let i = 0; i < parsed.stations.length; i++) {
					const result = outputSchema.safeParse(parsed.stations[i])
					if (result.success) {
						validated.push(result.data)
					} else {
						errors.push(
							`Station index ${i}: ${result.error.issues.map((e) => e.message).join(', ')}`
						)
					}
				}

				if (errors.length > 0) {
					throw new Error(
						`${passName}: ${errors.length} stations failed validation:\n${errors.join('\n')}`
					)
				}

				// Verify all expected IDs are present
				const returnedIds = new Set(validated.map((s) => s.id))
				const expectedIds = new Set(
					(input as Array<{ id: number }>).map((s) => s.id)
				)
				for (const id of expectedIds) {
					if (!returnedIds.has(id)) {
						throw new Error(
							`${passName}: station ID ${id} missing from LLM output`
						)
					}
				}

				return validated
			} catch (e) {
				const errorMsg = e instanceof Error ? e.message : String(e)
				console.error(
					`[${passName}] Attempt ${attempt}/${MAX_LLM_RETRIES} failed: ${errorMsg}`
				)

				if (attempt === MAX_LLM_RETRIES) {
					throw new Error(
						`\n` +
							`${'='.repeat(72)}\n` +
							`FATAL: ${passName} failed after ${MAX_LLM_RETRIES} attempts.\n` +
							`Last error: ${errorMsg}\n` +
							`Batch size: ${expectedCount} stations\n` +
							`${'='.repeat(72)}\n` +
							`The data pipeline CANNOT proceed. This batch must be investigated.`,
						{ cause: e }
					)
				}
			}
		}

		// TypeScript: unreachable, but keeps the compiler happy
		throw new Error('Unreachable')
	}

	// ─── Data Pipeline ─────────────────────────────────────────────────────

	/**
	 * Cleans a batch of preprocessed stations through both LLM passes.
	 *
	 * 1. Assigns sequential IDs
	 * 2. Pass 1: Name/brand correction
	 * 3. Pass 2: Address correction (with corrected trading names)
	 * 4. Restores original node IDs
	 * 5. Merges all results into final cleaned objects
	 */
	/**
	 * Looks up the sequential ID for a node, throwing if not found.
	 */
	private static getSeqId(mapping: IdMapping, nodeId: string): number {
		const seqId = mapping.toSequential.get(nodeId)
		if (seqId === undefined) {
			throw new Error(`Node ID ${nodeId} not found in ID mapping`)
		}
		return seqId
	}

	private async cleanBatch(batch: PreprocessedStation[]) {
		// Assign sequential IDs
		const nodeIds = batch.map((s) => s.nodeId)
		const idMapping = createIdMapping(nodeIds)

		// ── Pass 1: Names ──────────────────────────────────────────────────

		const nameInput: NameCorrectionInput[] = batch.map((s) => ({
			id: PetrolBabyObject.getSeqId(idMapping, s.nodeId),
			tradingName: s.tradingName,
			brandName: s.brandName,
			isSupermarket: s.isSupermarketServiceStation,
			isMotorway: s.isMotorwayServiceStation,
			address1: s.address.address1,
			address2: s.address.address2,
			city: s.address.city,
			postcode: s.address.postcode
		}))

		const nameOutput = await this.correctNames(nameInput)

		// Index name results by sequential ID for fast lookup
		const nameById = new Map<number, NameCorrectionOutput>()
		for (const n of nameOutput) {
			nameById.set(n.id, n)
		}

		// ── Pass 2: Addresses (with corrected trading names) ───────────────

		const addressInput: AddressCorrectionInput[] = batch.map((s) => {
			const seqId = PetrolBabyObject.getSeqId(idMapping, s.nodeId)
			const correctedName = nameById.get(seqId)

			return {
				id: seqId,
				tradingName: correctedName?.tradingName ?? s.tradingName,
				address1: s.address.address1,
				address2: s.address.address2,
				city: s.address.city,
				country: s.address.country,
				postcode: s.address.postcode,
				latitude: s.coords.latitude,
				longitude: s.coords.longitude
			}
		})

		const addressOutput = await this.correctAddresses(addressInput)

		// Index address results by sequential ID
		const addressById = new Map<number, AddressCorrectionOutput>()
		for (const a of addressOutput) {
			addressById.set(a.id, a)
		}

		// ── Merge everything ───────────────────────────────────────────────

		return batch.map((s) => {
			const seqId = PetrolBabyObject.getSeqId(idMapping, s.nodeId)
			const name = nameById.get(seqId)
			const addr = addressById.get(seqId)

			if (!name || !addr) {
				throw new Error(
					`Missing LLM output for station ${s.nodeId} (seq ID ${seqId})`
				)
			}

			return {
				nodeId: restoreId(idMapping, seqId),
				tradingName: name.tradingName,
				brandName: name.brandName,
				phone: s.phone,
				isMotorwayServiceStation: s.isMotorwayServiceStation,
				isSupermarketServiceStation: s.isSupermarketServiceStation,
				address1: addr.address1,
				address2: addr.address2,
				city: addr.city,
				country: addr.country,
				postcode: addr.postcode,
				latitude: s.coords.latitude,
				longitude: s.coords.longitude,
				coordinatesValid: s.coords.valid
			}
		})
	}

	// ─── Fetch ─────────────────────────────────────────────────────────────

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

	// ─── Backfill Orchestration ────────────────────────────────────────────

	private async backfillStations() {
		const allStations = await this.fetchAllStations()
		if (!allStations) return

		// Phase 1: Filter out stations with no node ID, then pre-process
		const validStations = allStations.filter(
			(s): s is FuelFinderStation & { node_id: string } => s.node_id !== null
		)
		if (validStations.length < allStations.length) {
			console.warn(
				`Dropped ${allStations.length - validStations.length} stations with null node_id`
			)
		}

		console.log(`Pre-processing ${validStations.length} stations...`)
		const preprocessed = validStations.map(preprocess)

		const coordsFixed = preprocessed.filter((s) => s.coords.valid).length
		const coordsBroken = preprocessed.length - coordsFixed
		console.log(
			`Coordinates: ${coordsFixed} valid, ${coordsBroken} could not be fixed`
		)

		// Phase 2: Batch and clean through LLM
		const batches: PreprocessedStation[][] = []
		for (let i = 0; i < preprocessed.length; i += LLM_BATCH_SIZE) {
			batches.push(preprocessed.slice(i, i + LLM_BATCH_SIZE))
		}
		console.log(
			`Cleaning ${preprocessed.length} stations in ${batches.length} batches of up to ${LLM_BATCH_SIZE}`
		)

		// Process all batches in parallel — each batch's two LLM passes
		// (names then addresses) are sequential internally, but batches
		// are independent of each other.
		const allCleaned = (
			await Promise.all(
				batches.map(async (batch, i) => {
					console.log(`Processing batch ${i + 1}/${batches.length}...`)
					return this.cleanBatch(batch)
				})
			)
		).flat()

		// Phase 3: Duplicate detection
		console.log('Detecting duplicates...')
		const duplicateCandidates: DuplicateCandidate[] = allCleaned.map((s) => ({
			nodeId: s.nodeId,
			latitude: s.latitude,
			longitude: s.longitude,
			address1: s.address1,
			postcode: s.postcode,
			brandName: s.brandName
		}))
		const duplicates = detectDuplicates(duplicateCandidates)
		console.log(`Found ${duplicates.size} stations with potential duplicates`)

		// Attach duplicate info to final results
		const finalStations = allCleaned.map((s) => ({
			...s,
			potentialDuplicates: duplicates.get(s.nodeId) ?? null
		}))

		// TODO: Do something with our beautiful data

		console.log(JSON.stringify(finalStations))
		console.log('Done!')
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
