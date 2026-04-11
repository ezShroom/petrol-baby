import type { MedianSummary } from '../types/MedianSummary'
import type { NormalizedPriceQuery } from '../types/NormalizedPriceQuery'
import type { ObservedPricePoint } from '../types/ObservedPricePoint'
import type { StationPriceResult } from '../types/StationPriceResult'
import type { SummarisePricesOutput } from '../types/SummarisePricesOutput'

function findPriceBlock(
	rows: StationPriceResult[],
	index: number
): { start: number; end: number } {
	const row = rows[index]
	if (!row) {
		return { start: index, end: index }
	}

	let start = index
	let end = index
	while (start > 0 && rows[start - 1]?.pricePence === row.pricePence) {
		start--
	}
	while (
		end < rows.length - 1 &&
		rows[end + 1]?.pricePence === row.pricePence
	) {
		end++
	}
	return { start, end }
}

function selectNearbyStations(
	rows: StationPriceResult[],
	anchorIndex: number,
	targetCount: number,
	mode: 'backward' | 'center' | 'forward'
): StationPriceResult[] {
	const block = findPriceBlock(rows, anchorIndex)
	let start = block.start
	let end = block.end

	while (end - start + 1 < targetCount) {
		if (mode === 'forward') {
			if (end >= rows.length - 1) break
			end++
			continue
		}
		if (mode === 'backward') {
			if (start <= 0) break
			start--
			continue
		}

		const canExpandLeft = start > 0
		const canExpandRight = end < rows.length - 1
		if (!canExpandLeft && !canExpandRight) break
		if (canExpandLeft && canExpandRight) {
			const leftDistance = anchorIndex - (start - 1)
			const rightDistance = end + 1 - anchorIndex
			if (leftDistance <= rightDistance) {
				start--
			} else {
				end++
			}
			continue
		}
		if (canExpandLeft) {
			start--
		} else {
			end++
		}
	}

	return rows.slice(start, end + 1)
}

function buildObservedPricePoint(
	query: NormalizedPriceQuery,
	rows: StationPriceResult[],
	rowsByPrice: Map<number, StationPriceResult[]>,
	rowIndex: number | undefined,
	mode: 'backward' | 'center' | 'forward'
): ObservedPricePoint | null {
	if (rowIndex === undefined) {
		return null
	}
	const row = rows[rowIndex]
	if (!row) {
		return null
	}

	return {
		pricePence: row.pricePence,
		stations: rowsByPrice.get(row.pricePence) ?? [row],
		nearbyStations: selectNearbyStations(
			rows,
			rowIndex,
			query.highlightSampleSize,
			mode
		),
		requestedStationCount: query.highlightSampleSize
	}
}

function nearestRankIndex(count: number, percentile: number): number {
	return Math.max(0, Math.ceil(count * percentile) - 1)
}

function buildMedianSummary(
	query: NormalizedPriceQuery,
	rows: StationPriceResult[]
): MedianSummary {
	if (rows.length === 0) {
		return { kind: 'none' }
	}

	const rowsByPrice = new Map<number, StationPriceResult[]>()
	for (const row of rows) {
		const existing = rowsByPrice.get(row.pricePence)
		if (existing) {
			existing.push(row)
		} else {
			rowsByPrice.set(row.pricePence, [row])
		}
	}

	if (rows.length % 2 === 1) {
		const point = buildObservedPricePoint(
			query,
			rows,
			rowsByPrice,
			Math.floor(rows.length / 2),
			'center'
		)
		if (!point) {
			return { kind: 'none' }
		}
		return {
			kind: 'single',
			pricePence: point.pricePence,
			stations: point.stations,
			nearbyStations: point.nearbyStations,
			requestedStationCount: point.requestedStationCount
		}
	}

	const lowerPoint = buildObservedPricePoint(
		query,
		rows,
		rowsByPrice,
		rows.length / 2 - 1,
		'center'
	)
	const upperPoint = buildObservedPricePoint(
		query,
		rows,
		rowsByPrice,
		rows.length / 2,
		'center'
	)

	if (!lowerPoint || !upperPoint) {
		return { kind: 'none' }
	}
	if (lowerPoint.pricePence === upperPoint.pricePence) {
		return {
			kind: 'single',
			pricePence: lowerPoint.pricePence,
			stations: lowerPoint.stations,
			nearbyStations: lowerPoint.nearbyStations,
			requestedStationCount: lowerPoint.requestedStationCount
		}
	}

	return {
		kind: 'pair',
		lower: lowerPoint,
		upper: upperPoint
	}
}

export function summarisePriceRows(
	query: NormalizedPriceQuery,
	rows: StationPriceResult[]
): SummarisePricesOutput {
	if (rows.length === 0) {
		return {
			query,
			stationCount: 0,
			minimum: null,
			maximum: null,
			meanPricePence: null,
			lowerQuartile: null,
			median: { kind: 'none' },
			upperQuartile: null,
			notes: ['No matching stations were found for this query.']
		}
	}

	const rowsByPrice = new Map<number, StationPriceResult[]>()
	for (const row of rows) {
		const existing = rowsByPrice.get(row.pricePence)
		if (existing) {
			existing.push(row)
		} else {
			rowsByPrice.set(row.pricePence, [row])
		}
	}

	const meanPricePence =
		rows.reduce((sum, row) => sum + row.pricePence, 0) / rows.length

	return {
		query,
		stationCount: rows.length,
		minimum: buildObservedPricePoint(query, rows, rowsByPrice, 0, 'forward'),
		maximum: buildObservedPricePoint(
			query,
			rows,
			rowsByPrice,
			rows.length - 1,
			'backward'
		),
		meanPricePence: Number(meanPricePence.toFixed(3)),
		lowerQuartile: buildObservedPricePoint(
			query,
			rows,
			rowsByPrice,
			nearestRankIndex(rows.length, 0.25),
			'center'
		),
		median: buildMedianSummary(query, rows),
		upperQuartile: buildObservedPricePoint(
			query,
			rows,
			rowsByPrice,
			nearestRankIndex(rows.length, 0.75),
			'center'
		),
		notes: [
			'Quartiles use nearest-rank observed station prices rather than interpolated prices.',
			'If multiple stations share a highlighted price, all of those stations are returned.',
			`Each highlighted point also includes up to ${query.highlightSampleSize} nearby stations to make the summary more practically useful.`,
			'For an even number of matches, the median returns both middle observations when they differ.'
		]
	}
}
