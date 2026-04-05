import { StatusCodes } from 'http-status-codes'
import { ms } from 'ms'
import {
	detectDuplicates,
	type DuplicateCandidate
} from '../cleanup/duplicates'
import { preprocess, type PreprocessedStation } from '../cleanup/preprocess'
import {
	baseUrl,
	PERSISTENT_ACCESS_TOKEN_REFRESH_WINDOW_MS,
	USER_AGENT
} from '../constants'
import type { FuelFinderOAuth } from '../oauth'
import { patientFetch } from '../patient_fetch'
import { parseJsonResponse } from '../response'
import type { FuelFinderStation } from '../types/FuelFinderStation'
import { LLM_BATCH_SIZE, StationCleaner } from './info_cleaner'

export class StationInfoHelper {
	private cleaner: StationCleaner
	private oauth: FuelFinderOAuth
	private env: Env

	constructor({ env, oauth }: { env: Env; oauth: FuelFinderOAuth }) {
		this.cleaner = new StationCleaner({ env })
		this.oauth = oauth
		this.env = env
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
				// $1M ratelimit handling
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

	public async backfillStations() {
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
					return this.cleaner.cleanBatch(batch)
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

		// Attach duplicate info to final results, return this thang
		return allCleaned.map((s) => ({
			...s,
			potentialDuplicates: duplicates.get(s.nodeId) ?? null
		}))
	}
}
