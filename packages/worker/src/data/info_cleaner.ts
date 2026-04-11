import addressPrompt from '@/prompts/addresses.md'
import namesPrompt from '@/prompts/names.md'
import { OpenRouter } from '@openrouter/sdk'
import { ms } from 'ms'
import z from 'zod'
import { createIdMapping, restoreId, type IdMapping } from '../cleanup/id_map'
import type { PreprocessedStation } from '../cleanup/preprocess'
import {
	AddressCorrectionOutputArrayJSONSchema,
	AddressCorrectionOutputSchema,
	NameCorrectionOutputArrayJSONSchema,
	NameCorrectionOutputSchema,
	type AddressCorrectionInput,
	type AddressCorrectionOutput,
	type NameCorrectionInput,
	type NameCorrectionOutput
} from '../types/CorrectableStationData'

/** Batch size for LLM calls — smaller = more focused attention per station */
export const LLM_BATCH_SIZE = 25

/** Maximum retries per LLM call before hard failure */
const MAX_LLM_RETRIES = 10

/** Timeout per individual LLM request */
const LLM_TIMEOUT_MS = ms('90s')

export class StationCleaner {
	private openrouterClient

	constructor({ env }: { env: Env }) {
		this.openrouterClient = new OpenRouter({ apiKey: env.OPENROUTER_API_KEY })
	}

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

	/**
	 * Generic LLM call with structured output, Zod validation, station count
	 * verification, and retry logic. Retries up to MAX_LLM_RETRIES times,
	 * then throws a loud error.
	 */
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
		const boundedSchema = StationCleaner.withArrayBounds(
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

	/**
	 * Cleans a batch of preprocessed stations through both LLM passes.
	 *
	 * 1. Assigns sequential IDs
	 * 2. Pass 1: Name/brand correction
	 * 3. Pass 2: Address correction (with corrected trading names)
	 * 4. Restores original node IDs
	 * 5. Merges all results into final cleaned objects
	 */
	async cleanBatch(batch: PreprocessedStation[]) {
		// Assign sequential IDs
		const nodeIds = batch.map((s) => s.nodeId)
		const idMapping = createIdMapping(nodeIds)

		// ── Pass 1: Names ──────────────────────────────────────────────────

		const nameInput: NameCorrectionInput[] = batch.map((s) => ({
			id: StationCleaner.getSeqId(idMapping, s.nodeId),
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
			const seqId = StationCleaner.getSeqId(idMapping, s.nodeId)
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
			const seqId = StationCleaner.getSeqId(idMapping, s.nodeId)
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
				coordinatesValid: s.coords.valid,
				amenities: s.amenities,
				openingTimes: s.openingTimes,
				fuelTypes: s.fuelTypes,
				temporarilyClosed: s.temporarilyClosed,
				permanentClosureDate: s.permanentClosureDate,
				originalHash: s.originalHash
			}
		})
	}
}
