import { StatusCodes } from 'http-status-codes'
import { ms } from 'ms'
import { authenticatedPatientFetch } from '../authenticated_fetch'
import { baseUrl, USER_AGENT } from '../constants'
import type { FuelFinderOAuth } from '../oauth'
import { parseJsonResponse } from '../response'
import type { FuelFinderStationPrice } from '../types/FuelFinderStationPrice'

export type BackfillPriceRecord = {
	nodeId: string
	typeCode: string
	timestamp: Date
	pricePence: number
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

export class PriceInfoHelper {
	private oauth: FuelFinderOAuth
	private env: Env

	constructor({ env, oauth }: { env: Env; oauth: FuelFinderOAuth }) {
		this.oauth = oauth
		this.env = env
	}

	private async fetchPrices({
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
		const allPrices: FuelFinderStationPrice[] = []

		while (true) {
			const params = new URLSearchParams({ 'batch-number': String(page) })
			if (effectiveStartTimestamp) {
				params.set('effective-start-timestamp', effectiveStartTimestamp)
			}

			const result = await authenticatedPatientFetch(
				this.oauth,
				`${baseUrl(this.env)}/v1/pfs/fuel-prices?${params.toString()}`,
				{
					headers: {
						Accept: 'application/json',
						'Content-Type': 'application/json',
						'User-Agent': USER_AGENT
					}
				}
			)

			if (result.status === StatusCodes.NOT_FOUND) {
				console.log('No more price pages')
				break
			}
			if (result.status === StatusCodes.TOO_MANY_REQUESTS) {
				console.warn('Ratelimited while fetching prices!')
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

			const rawArr = await parseJsonResponse<FuelFinderStationPrice[]>(result, {
				context: `${batchLabel} ${page}`
			})
			allPrices.push(...rawArr)
			page++
		}

		console.log(`${completionLabel}: ${allPrices.length} station price rows`)
		return allPrices
	}

	private async fetchAllPrices() {
		return this.fetchPrices({
			requestLabel: 'Could not backfill prices',
			batchLabel: 'Fuel Finder prices batch',
			completionLabel: 'Fetched all prices'
		})
	}

	private async fetchIncrementalPricesRaw(since: Date) {
		const fullTimestamp = since.toISOString()

		try {
			return await this.fetchPrices({
				effectiveStartTimestamp: fullTimestamp,
				requestLabel: 'Could not fetch incremental prices',
				batchLabel: 'Fuel Finder incremental prices batch',
				completionLabel: `Fetched incremental prices since ${fullTimestamp}`
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
				`Incremental price endpoint rejected full timestamp; retrying with date-only cursor ${dateOnly}`
			)
			return this.fetchPrices({
				effectiveStartTimestamp: dateOnly,
				requestLabel: 'Could not fetch incremental prices',
				batchLabel: 'Fuel Finder incremental prices batch',
				completionLabel: `Fetched incremental prices since ${dateOnly}`
			})
		}
	}

	private preparePrices(
		allPrices: FuelFinderStationPrice[]
	): BackfillPriceRecord[] {
		let missingNodeIdCount = 0
		let invalidTimestampCount = 0

		const priceRows: BackfillPriceRecord[] = allPrices.flatMap((station) => {
			if (!station.node_id) {
				missingNodeIdCount++
				return []
			}
			return station.fuel_prices
				.map((fuelPrice) => {
					const timestamp = new Date(fuelPrice.price_last_updated)
					if (Number.isNaN(timestamp.getTime())) {
						invalidTimestampCount++
						return null
					}
					const pricePence =
						fuelPrice.price < 30 ? fuelPrice.price * 100 : fuelPrice.price

					return {
						nodeId: station.node_id,
						typeCode: fuelPrice.fuel_type,
						timestamp,
						pricePence
					}
				})
				.filter((row): row is BackfillPriceRecord => row !== null)
		})

		if (missingNodeIdCount > 0) {
			console.warn(
				`Dropped ${missingNodeIdCount} price station rows with null node_id`
			)
		}
		if (invalidTimestampCount > 0) {
			console.warn(
				`Dropped ${invalidTimestampCount} price rows with invalid price_last_updated`
			)
		}

		return priceRows
	}

	public async backfillPrices(): Promise<BackfillPriceRecord[]> {
		const allPrices = await this.fetchAllPrices()
		if (allPrices.length === 0) throw new Error('No prices found.')

		const priceRows = this.preparePrices(allPrices)
		console.log(`Prepared ${priceRows.length} pricing events for backfill`)
		return priceRows
	}

	public async fetchIncrementalPrices(
		since: Date
	): Promise<BackfillPriceRecord[]> {
		const allPrices = await this.fetchIncrementalPricesRaw(since)
		const priceRows = this.preparePrices(allPrices)
		console.log(
			`Prepared ${priceRows.length} pricing events for incremental update`
		)
		return priceRows
	}
}
