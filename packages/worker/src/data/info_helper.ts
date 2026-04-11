import { StatusCodes } from 'http-status-codes'
import { ms } from 'ms'
import { authenticatedPatientFetch } from '../authenticated_fetch'
import {
	detectDuplicates,
	type DuplicateCandidate
} from '../cleanup/duplicates'
import { preprocess, type PreprocessedStation } from '../cleanup/preprocess'
import { baseUrl, USER_AGENT } from '../constants'
import type { FuelFinderOAuth } from '../oauth'
import { parseJsonResponse } from '../response'
import type { FuelFinderStation } from '../types/FuelFinderStation'
import { LLM_BATCH_SIZE, StationCleaner } from './info_cleaner'

export type CleanedStationRecord = {
	nodeId: string
	tradingName: string
	brandName: string
	phone: string | null
	isMotorwayServiceStation: boolean
	isSupermarketServiceStation: boolean
	address1: string | null
	address2: string | null
	city: string | null
	country: string | null
	postcode: string | null
	latitude: number
	longitude: number
	coordinatesValid: boolean
	amenities: string[]
	openingTimes: PreprocessedStation['openingTimes']
	fuelTypes: string[]
	temporarilyClosed: boolean
	permanentClosureDate: string | null
	originalHash: string
}

export type StationRecordWithDuplicates = CleanedStationRecord & {
	potentialDuplicates: string[] | null
}

class FuelFinderApiError extends Error {
	constructor(
		message: string,
		public readonly status: number
	) {
		super(message)
		this.name = 'FuelFinderApiError'
	}
}

function formatDateOnly(date: Date): string {
	return date.toISOString().slice(0, 10)
}

export class StationInfoHelper {
	private cleaner: StationCleaner
	private oauth: FuelFinderOAuth
	private env: Env

	constructor({ env, oauth }: { env: Env; oauth: FuelFinderOAuth }) {
		this.cleaner = new StationCleaner({ env })
		this.oauth = oauth
		this.env = env
	}

	private async fetchStations({
		effectiveStartTimestamp,
		requestLabel,
		batchLabel,
		completionLabel
	}: {
		effectiveStartTimestamp?: string
		requestLabel: string
		batchLabel: string
		completionLabel: string
	}) {
		let page = 1
		const allStations: FuelFinderStation[] = []

		while (true) {
			const params = new URLSearchParams({ 'batch-number': String(page) })
			if (effectiveStartTimestamp) {
				params.set('effective-start-timestamp', effectiveStartTimestamp)
			}

			const result = await authenticatedPatientFetch(
				this.oauth,
				`${baseUrl(this.env)}/v1/pfs?${params.toString()}`,
				{
					headers: {
						Accept: 'application/json',
						'Content-Type': 'application/json',
						'User-Agent': USER_AGENT
					}
				}
			)

			if (result.status === StatusCodes.NOT_FOUND) {
				console.log('No more station pages')
				break
			}
			if (result.status === StatusCodes.TOO_MANY_REQUESTS) {
				console.warn('Ratelimited while fetching stations!')
				console.debug(await result.text())
				await new Promise((resolve) => setTimeout(resolve, ms('2s')))
				continue
			}
			if (!result.ok) {
				const body = await result.text()
				console.error(`${requestLabel}: ${result.status} ${result.statusText}`)
				console.debug(body)
				throw new FuelFinderApiError(
					`${requestLabel}: ${result.status} ${result.statusText}`,
					result.status
				)
			}

			const rawArr = await parseJsonResponse<FuelFinderStation[]>(result, {
				context: `${batchLabel} ${page}`
			})
			allStations.push(...rawArr)
			page++
		}

		console.log(`${completionLabel}: ${allStations.length} stations`)
		return allStations
	}

	private async fetchAllStations() {
		return this.fetchStations({
			requestLabel: 'Could not backfill stations',
			batchLabel: 'Fuel Finder stations batch',
			completionLabel: 'Fetched all stations'
		})
	}

	private async fetchIncrementalStationsRaw(since: Date) {
		const fullTimestamp = since.toISOString()

		try {
			return await this.fetchStations({
				effectiveStartTimestamp: fullTimestamp,
				requestLabel: 'Could not fetch incremental stations',
				batchLabel: 'Fuel Finder incremental stations batch',
				completionLabel: `Fetched incremental stations since ${fullTimestamp}`
			})
		} catch (error) {
			if (
				!(error instanceof FuelFinderApiError) ||
				error.status !== StatusCodes.BAD_REQUEST
			) {
				throw error
			}

			const dateOnly = formatDateOnly(since)
			console.warn(
				`Incremental station endpoint rejected full timestamp; retrying with date-only cursor ${dateOnly}`
			)
			return this.fetchStations({
				effectiveStartTimestamp: dateOnly,
				requestLabel: 'Could not fetch incremental stations',
				batchLabel: 'Fuel Finder incremental stations batch',
				completionLabel: `Fetched incremental stations since ${dateOnly}`
			})
		}
	}

	private async preprocessStations(allStations: FuelFinderStation[]) {
		const validStations = allStations.filter(
			(s): s is FuelFinderStation & { node_id: string } => s.node_id !== null
		)
		if (validStations.length < allStations.length) {
			console.warn(
				`Dropped ${allStations.length - validStations.length} stations with null node_id`
			)
		}

		console.log(`Pre-processing ${validStations.length} stations...`)
		const preprocessed = await Promise.all(validStations.map(preprocess))

		const coordsFixed = preprocessed.filter((s) => s.coords.valid).length
		const coordsBroken = preprocessed.length - coordsFixed
		console.log(
			`Coordinates: ${coordsFixed} valid, ${coordsBroken} could not be fixed`
		)

		return preprocessed
	}

	public async cleanStations(
		preprocessed: PreprocessedStation[]
	): Promise<CleanedStationRecord[]> {
		if (preprocessed.length === 0) {
			return []
		}

		const batches: PreprocessedStation[][] = []
		for (let i = 0; i < preprocessed.length; i += LLM_BATCH_SIZE) {
			batches.push(preprocessed.slice(i, i + LLM_BATCH_SIZE))
		}
		console.log(
			`Cleaning ${preprocessed.length} stations in ${batches.length} batches of up to ${LLM_BATCH_SIZE}`
		)

		return (
			await Promise.all(
				batches.map(async (batch, i) => {
					try {
						return await this.cleaner.cleanBatch(batch)
					} catch (error) {
						throw new Error(
							`Processing batch ${i + 1}/${batches.length} failed`,
							{ cause: error }
						)
					}
				})
			)
		).flat()
	}

	public async fetchIncrementalStations(
		since: Date
	): Promise<PreprocessedStation[]> {
		const allStations = await this.fetchIncrementalStationsRaw(since)
		return this.preprocessStations(allStations)
	}

	public async backfillStations(): Promise<StationRecordWithDuplicates[]> {
		const allStations = await this.fetchAllStations()
		if (allStations.length === 0) throw new Error('No stations found.')

		const preprocessed = await this.preprocessStations(allStations)
		const allCleaned = await this.cleanStations(preprocessed)

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

		return allCleaned.map((s) => ({
			...s,
			potentialDuplicates: duplicates.get(s.nodeId) ?? null
		}))
	}
}
