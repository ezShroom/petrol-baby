/**
 * Deterministic pre-processing pipeline for fuel station data.
 *
 * Runs before any LLM calls to handle all the cleanup that doesn't
 * require judgment: coordinate fixing, phone formatting, postcode
 * normalisation, country inference, and null normalisation.
 */

import type { FuelFinderStation } from '@/types/FuelFinderStation'
import { fixCoordinates, type CoordinateFixResult } from './coordinates'
import { inferCountry, type UKCountry } from './country'
import { formatPhoneNumber } from './phone'
import { formatPostcode } from './postcode'

export type PreprocessedStation = {
	nodeId: string
	tradingName: string
	brandName: string
	phone: string | null
	isMotorwayServiceStation: boolean
	isSupermarketServiceStation: boolean
	address: {
		address1: string | null
		address2: string | null
		city: string | null
		country: UKCountry
		postcode: string | null
	}
	coords: {
		latitude: number
		longitude: number
		valid: boolean
	}
}

/**
 * Normalise a nullable string field: trim whitespace, convert empty
 * strings to null.
 */
function normaliseNullable(s: string | null | undefined): string | null {
	if (s === null || s === undefined) return null
	const trimmed = s.trim()
	return trimmed === '' ? null : trimmed
}

/**
 * Runs the full deterministic pre-processing pipeline on a single
 * raw station from the Fuel Finder API.
 */
export function preprocess(
	station: FuelFinderStation & { node_id: string }
): PreprocessedStation {
	// Normalise all nullable string fields
	const address1 = normaliseNullable(station.location.address_line_1)
	const address2 = normaliseNullable(station.location.address_line_2)
	const city = normaliseNullable(station.location.city)
	const rawCountry = normaliseNullable(station.location.country)
	const rawPostcode = normaliseNullable(station.location.postcode)

	// Fix coordinates
	const coordResult: CoordinateFixResult = fixCoordinates(
		station.location.latitude,
		station.location.longitude
	)

	// Format postcode (inserts space, validates structure)
	const formattedPostcode = rawPostcode
		? (formatPostcode(rawPostcode) ?? rawPostcode)
		: null

	// Infer/normalise country from postcode area
	const country = inferCountry(rawCountry, formattedPostcode ?? rawPostcode)

	// Format phone number
	const phone = formatPhoneNumber(
		normaliseNullable(station.public_phone_number)
	)

	return {
		nodeId: station.node_id,
		tradingName: station.trading_name,
		brandName: station.brand_name,
		phone,
		isMotorwayServiceStation: station.is_motorway_service_station,
		isSupermarketServiceStation: station.is_supermarket_service_station,
		address: {
			address1,
			address2,
			city,
			country,
			postcode: formattedPostcode ?? rawPostcode
		},
		coords: {
			latitude: coordResult.latitude,
			longitude: coordResult.longitude,
			valid: coordResult.valid
		}
	}
}
