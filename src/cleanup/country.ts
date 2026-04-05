/**
 * Infers UK constituent country from postcode area prefix.
 *
 * Note: Some postcode areas straddle borders (e.g., SY covers parts of
 * both England and Wales). In ambiguous cases we make the most likely
 * assignment; the LLM address pass can refine if needed.
 */

import { extractArea } from './postcode'

export type UKCountry = 'England' | 'Wales' | 'Scotland' | 'Northern Ireland'

const SCOTLAND_AREAS = new Set([
	'AB', // Aberdeen
	'DD', // Dundee
	'DG', // Dumfries & Galloway
	'EH', // Edinburgh
	'FK', // Falkirk / Stirling
	'G', //  Glasgow
	'HS', // Outer Hebrides
	'IV', // Inverness
	'KA', // Kilmarnock
	'KW', // Kirkwall / Wick
	'KY', // Kirkcaldy
	'ML', // Motherwell
	'PA', // Paisley
	'PH', // Perth
	'TD', // Galashiels / Tweeddale
	'ZE' // Shetland (Zetland)
])

const WALES_AREAS = new Set([
	'CF', // Cardiff
	'LD', // Llandrindod Wells
	'LL', // Llandudno
	'NP', // Newport
	'SA', // Swansea
	'SY' // Shrewsbury (straddles, but predominantly used for mid-Wales)
])

const NORTHERN_IRELAND_AREAS = new Set([
	'BT' // Belfast (covers all of Northern Ireland)
])

/**
 * Given a postcode area prefix (e.g., "BT", "EH", "CF"), returns the
 * most likely constituent country.
 */
export function countryFromArea(area: string): UKCountry {
	const upper = area.toUpperCase()
	if (NORTHERN_IRELAND_AREAS.has(upper)) return 'Northern Ireland'
	if (SCOTLAND_AREAS.has(upper)) return 'Scotland'
	if (WALES_AREAS.has(upper)) return 'Wales'
	return 'England'
}

/**
 * Common raw country values that need normalising.
 */
const COUNTRY_ALIASES: Record<string, UKCountry | 'infer'> = {
	ENGLAND: 'England',
	WALES: 'Wales',
	SCOTLAND: 'Scotland',
	'NORTHERN IRELAND': 'Northern Ireland',
	'N. IRELAND': 'Northern Ireland',
	'N IRELAND': 'Northern Ireland',
	'UNITED KINGDOM': 'infer',
	UK: 'infer',
	'GREAT BRITAIN': 'infer',
	GB: 'infer'
}

/**
 * Infers or normalises the country field.
 *
 * - If the raw country is already a valid constituent country name
 *   (case-insensitive), it gets normalised to proper casing.
 * - If the raw country is a generic term like "United Kingdom" or "UK",
 *   or is null/empty, we infer from the postcode area.
 * - Falls back to inferring from postcode if nothing else works.
 */
export function inferCountry(
	rawCountry: string | null,
	postcode: string | null
): UKCountry {
	const normalised = rawCountry?.trim().toUpperCase() ?? ''

	const mapped = COUNTRY_ALIASES[normalised]

	if (mapped && mapped !== 'infer') {
		return mapped
	}

	// Need to infer from postcode
	if (postcode) {
		const area = extractArea(postcode)
		if (area) {
			return countryFromArea(area)
		}
	}

	// Last resort: most stations are in England
	return 'England'
}
