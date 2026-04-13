import type { ListPricesOutput } from '../types/ListPricesOutput'
import type { StationPriceResult } from '../types/StationPriceResult'
import type { SummarisePricesOutput } from '../types/SummarisePricesOutput'

function formatPricePence(pricePence: number): string {
	return `${Number(pricePence.toFixed(1))}p`
}

function formatStationLabel(station: StationPriceResult): string {
	const name = station.tradingName ?? station.brandName ?? station.nodeId
	const postcode = station.postcode ? ` (${station.postcode})` : ''
	return `${name}${postcode}`
}

function formatAtLabel(at: string | null): string {
	return at ? ` as of ${at}` : ''
}

export function buildListPricesText(result: ListPricesOutput): string {
	const atLabel = formatAtLabel(result.query.at)
	if (result.items.length === 0) {
		return `No ${result.query.fuelType} prices matched this query${atLabel}.`
	}

	const [cheapest] = result.items
	if (!cheapest) {
		return `No ${result.query.fuelType} prices matched this query${atLabel}.`
	}

	const lines = [
		`Matched ${result.returnedCount} ${result.query.fuelType} station price${result.returnedCount === 1 ? '' : 's'}${atLabel}${result.isTruncated ? ' (truncated to 20 results)' : ''}.`,
		`Cheapest returned result is ${formatPricePence(cheapest.pricePence)} at ${formatStationLabel(cheapest)}.`
	]
	if (result.truncationMessage) {
		lines.push(result.truncationMessage)
		lines.push(
			'For larger matching sets, use summarise_prices to analyse the full result set without the 20-station list cap.'
		)
	}
	return lines.join(' ')
}

export function buildSummaryText(result: SummarisePricesOutput): string {
	const atLabel = formatAtLabel(result.query.at)
	if (result.stationCount === 0 || !result.minimum || !result.maximum) {
		return `No ${result.query.fuelType} prices matched this query${atLabel}.`
	}

	const lines = [
		`Matched ${result.stationCount} station price${result.stationCount === 1 ? '' : 's'} for ${result.query.fuelType}${atLabel}.`,
		`Cheapest price is ${formatPricePence(result.minimum.pricePence)} at ${result.minimum.stations.length} station${result.minimum.stations.length === 1 ? '' : 's'}.`,
		`Highest price is ${formatPricePence(result.maximum.pricePence)} at ${result.maximum.stations.length} station${result.maximum.stations.length === 1 ? '' : 's'}.`,
		result.meanPricePence === null
			? 'Mean price is unavailable.'
			: `Mean price is ${formatPricePence(result.meanPricePence)}.`
	]

	return lines.join(' ')
}
