import { extractOutcode, formatPostcode } from '../cleanup/postcode'
import type { NormalizedPriceQuery } from '../types/NormalizedPriceQuery'
import type { PriceQueryArea } from '../types/PriceQueryArea'
import type { PriceQueryInput } from '../types/PriceQueryInput'

function cleanNonEmptyString(
	value: string | null | undefined
): string | undefined {
	const trimmed = value?.trim()
	return trimmed ? trimmed : undefined
}

function uniqueStrings(values: string[]): string[] {
	return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function normalizePostcodePrefix(prefix: string): string {
	const outcode = extractOutcode(prefix)
	const normalized = outcode ?? prefix.trim().toUpperCase()
	return normalized.replace(/\s+/g, '')
}

function normalizeArea(area: PriceQueryArea): PriceQueryArea {
	switch (area.scope) {
		case 'all_uk':
		case 'country':
			return area
		case 'city':
			return {
				scope: 'city',
				city: area.city.trim(),
				country: area.country
			}
		case 'postcode':
			return {
				scope: 'postcode',
				postcode:
					formatPostcode(area.postcode) ?? area.postcode.trim().toUpperCase()
			}
		case 'postcode_prefix':
			return {
				scope: 'postcode_prefix',
				prefix: normalizePostcodePrefix(area.prefix)
			}
	}
}

export function normalizePriceQuery(
	input: PriceQueryInput
): NormalizedPriceQuery {
	const station = input.station
	const normalizedStation = station
		? {
				nodeId: cleanNonEmptyString(station.nodeId),
				tradingName: cleanNonEmptyString(station.tradingName),
				brandName: cleanNonEmptyString(station.brandName),
				postcode: station.postcode
					? (formatPostcode(station.postcode) ??
						station.postcode.trim().toUpperCase())
					: undefined
			}
		: null

	const normalizedAreas = (input.areas ?? (input.area ? [input.area] : []))
		.map(normalizeArea)
		.filter((area, index, areas) => {
			const serialized = JSON.stringify(area)
			return (
				areas.findIndex(
					(candidate) => JSON.stringify(candidate) === serialized
				) === index
			)
		})

	return {
		fuelType: input.fuelType.trim(),
		areas: normalizedAreas.some((area) => area.scope === 'all_uk')
			? [{ scope: 'all_uk' }]
			: normalizedAreas,
		amenities: uniqueStrings(input.amenities),
		availableFuelTypes: uniqueStrings(input.availableFuelTypes),
		highlightSampleSize: input.highlightSampleSize,
		station:
			normalizedStation &&
			Object.values(normalizedStation).some((value) => value !== undefined)
				? normalizedStation
				: null,
		includeClosed: input.includeClosed
	}
}
