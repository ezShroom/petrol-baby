import type { FuelPrice } from '../data/fuel_naming'

/** A single fuel's current price at a station. */
export type { FuelPrice }

/** Opening hours for one day (0=Mon … 6=Sun, 7=BankHoliday). */
export type StationOpeningTime = {
	day: number
	openTime: string
	closeTime: string
	is24Hours: boolean
}

/** Core station identity shared across the page payloads. */
export type StationIdentity = {
	nodeId: string
	slug: string
	displayName: string
	tradingName: string | null
	brandName: string | null
	address1: string | null
	address2: string | null
	city: string | null
	country: string | null
	postcode: string | null
	latitude: number | null
	longitude: number | null
	isMotorwayService: boolean | null
	isSupermarketService: boolean | null
	temporarilyClosed: boolean | null
	permanentClosureDate: string | null
}

/** One fuel's price shown on a comparison row (label kept for accessibility). */
export type ComparisonPrice = {
	code: string
	label: string
	pricePence: number | null
}

/** A nearby / cheapest comparison row. */
export type ComparisonStation = {
	nodeId: string
	slug: string | null
	displayName: string
	brandName: string | null
	city: string | null
	postcode: string | null
	/** Prices for the anchor's headline fuels (e.g. unleaded / diesel). */
	prices: ComparisonPrice[]
	/** Straight-line distance in km from the anchor station (nearby only). */
	distanceKm: number | null
}

/** A single price observation for the history chart. */
export type PriceHistoryPoint = {
	timestamp: string
	pricePence: number
}

/** Per-fuel-type comparison data (history + nearby + cheapest in city). */
export type CompareData = {
	fuelType: string
	label: string
	/** The fuels shown as the two-price pair on each comparison row. */
	displayFuels: { code: string; label: string }[]
	history: PriceHistoryPoint[]
	nearby: ComparisonStation[]
	/** Cheapest stations within a radius of the anchor (not strict city match). */
	cheapest: ComparisonStation[]
}

/** Everything needed to render a station page on first paint. */
export type StationPagePayload = {
	station: StationIdentity
	amenities: string[]
	openingTimes: StationOpeningTime[]
	fuels: FuelPrice[]
	headline: FuelPrice[]
	defaultFuel: string | null
	compare: CompareData | null
	lastUpdated: string | null
}

/** A row in the all-stations index. */
export type StationListItem = {
	nodeId: string
	slug: string
	displayName: string
	brandName: string | null
	city: string | null
	postcode: string | null
}

export type StationListResult = {
	items: StationListItem[]
	nextCursor: string | null
}

export type SitemapEntry = {
	slug: string
	lastmod: string | null
}

export type SitemapResult = {
	items: SitemapEntry[]
	nextCursor: string | null
}

/** Resolution result for a requested slug (drives canonical 301s / 404s). */
export type SlugResolution =
	| { status: 'ok'; payload: StationPagePayload; canonicalSlug: string }
	| { status: 'redirect'; canonicalSlug: string }
	| { status: 'not_found' }
