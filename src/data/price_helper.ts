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

export class PriceInfoHelper {
	private oauth: FuelFinderOAuth
	private env: Env

	constructor({ env, oauth }: { env: Env; oauth: FuelFinderOAuth }) {
		this.oauth = oauth
		this.env = env
	}

	private async fetchAllPrices() {
		let page = 1
		const allPrices: FuelFinderStationPrice[] = []
		while (true) {
			const result = await authenticatedPatientFetch(
				this.oauth,
				baseUrl(this.env) + `/v1/pfs/fuel-prices?batch-number=${page}`,
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
				console.error(
					`Could not backfill prices: ${result.status} ${result.statusText}`
				)
				console.debug(await result.text())
				return
			}

			const rawArr = await parseJsonResponse<FuelFinderStationPrice[]>(result, {
				context: `Fuel Finder prices batch ${page}`
			})
			allPrices.push(...rawArr)
			page++
		}
		console.log(
			`Fetched ${allPrices.length} price station rows across ${page - 1} pages`
		)
		return allPrices
	}

	public async backfillPrices(): Promise<BackfillPriceRecord[]> {
		const allPrices = await this.fetchAllPrices()
		if (!allPrices) throw new Error('No prices found.')

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

		console.log(`Prepared ${priceRows.length} pricing events for backfill`)
		return priceRows
	}
}
