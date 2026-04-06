/**
 * Deterministic pre-processing pipeline for fuel station data.
 *
 * Runs before any LLM calls to handle all the cleanup that doesn't
 * require judgment: coordinate fixing, phone formatting, postcode
 * normalisation, country inference, and null normalisation.
 */

import type { FuelFinderStation, OpeningTimes } from '@/types/FuelFinderStation'
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
	amenities: string[]
	openingTimes: OpeningTimes
	fuelTypes: string[]
	/** SHA-256 hex digest of the original (pre-cleaning) trading name,
	 *  brand name, address fields, and coordinates from the API. Used to
	 *  detect upstream changes that require re-running the cleaning pipeline. */
	originalHash: string
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
 * Hashes the original (pre-cleaning) fields that the LLM pipeline may
 * modify: trading name, brand name, address, and coordinates. The
 * resulting hex digest can be compared against a stored value to detect
 * upstream changes that require re-cleaning.
 *
 * Uses SHA-256 via the Web Crypto API (available on Cloudflare Workers).
 */
async function hashOriginalFields(station: FuelFinderStation): Promise<string> {
	const data = JSON.stringify([
		station.trading_name,
		station.brand_name,
		station.location.address_line_1,
		station.location.address_line_2,
		station.location.city,
		station.location.country,
		station.location.postcode,
		station.location.latitude,
		station.location.longitude
	])
	const digest = await crypto.subtle.digest(
		'SHA-256',
		new TextEncoder().encode(data)
	)
	return [...new Uint8Array(digest)]
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('')
}

/**
 * Runs the full deterministic pre-processing pipeline on a single
 * raw station from the Fuel Finder API.
 */
export async function preprocess(
	station: FuelFinderStation & { node_id: string }
): Promise<PreprocessedStation> {
	// Hash original fields before any cleaning
	const originalHash = await hashOriginalFields(station)

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
		},
		amenities: station.amenities,
		openingTimes: station.opening_times,
		fuelTypes: station.fuel_types,
		originalHash
	}
}
