import {
	and,
	asc,
	eq,
	gt,
	gte,
	inArray,
	isNotNull,
	isNull,
	like,
	lte,
	ne,
	or,
	sql,
	type SQL
} from 'drizzle-orm'
import { max } from 'drizzle-orm/sql/functions/aggregate'
import { MAX_SQLITE_VARS_PER_STATEMENT } from '../constants'
import type { AppDatabase } from '../db/client'
import {
	availableFuelType,
	fuelStation,
	knownAmenity,
	pricingEvent,
	stationAmenity,
	stationOpeningTime
} from '../db/schema'
import type {
	CompareData,
	ComparisonStation,
	PriceHistoryPoint,
	SitemapResult,
	SlugResolution,
	StationIdentity,
	StationListResult,
	StationOpeningTime,
	StationPagePayload
} from '../types/StationPagePayload'
import { prettifyAmenityCode } from './amenity_namer'
import {
	decorateFuels,
	fuelLabel,
	selectDefaultFuel,
	selectHeadlineFuels
} from './fuel_naming'
import { extractSlugToken } from './slug'

const NEARBY_LIMIT = 5
const CHEAPEST_LIMIT = 5
const HISTORY_LIMIT = 500
const NEARBY_CANDIDATE_LIMIT = 120
const NEARBY_BBOX_LAT_DELTA = 0.6
const NEARBY_BBOX_LNG_DELTA = 0.9
const LIST_PAGE_SIZE = 100
const SITEMAP_PAGE_SIZE = 1000
const EARTH_RADIUS_KM = 6371

type FuelStationRow = typeof fuelStation.$inferSelect

/** Comparison row before the headline-fuel prices are attached. */
type RawComparisonRow = {
	nodeId: string
	slug: string | null
	displayName: string
	brandName: string | null
	city: string | null
	postcode: string | null
	distanceKm: number | null
}

function toIso(timestamp: Date | number | string | null): string | null {
	if (timestamp === null) return null
	return (
		timestamp instanceof Date ? timestamp : new Date(Number(timestamp))
	).toISOString()
}

function displayNameOf(station: {
	tradingName: string | null
	brandName: string | null
}): string {
	return station.tradingName ?? station.brandName ?? 'Fuel station'
}

function haversineKm(
	lat1: number,
	lon1: number,
	lat2: number,
	lon2: number
): number {
	const toRad = (deg: number) => (deg * Math.PI) / 180
	const dLat = toRad(lat2 - lat1)
	const dLon = toRad(lon2 - lon1)
	const a =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
	return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function encodeCursor(value: Record<string, unknown>): string {
	const bytes = new TextEncoder().encode(JSON.stringify(value))
	let binary = ''
	for (const byte of bytes) binary += String.fromCharCode(byte)
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function decodeCursor(cursor: string | null): Record<string, unknown> | null {
	if (!cursor) return null
	try {
		const binary = atob(cursor.replace(/-/g, '+').replace(/_/g, '/'))
		const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
		const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes))
		return typeof parsed === 'object' && parsed !== null
			? (parsed as Record<string, unknown>)
			: null
	} catch {
		return null
	}
}

/**
 * Read-side queries that back the public web pages. Kept separate from the
 * MCP/agent query helper because the access patterns differ (slug lookup,
 * geographic proximity, sitemap streaming) and the shapes are tailored for
 * server-side rendering rather than tool output.
 */
export class WebQueryHelper {
	constructor(private readonly db: AppDatabase) {}

	// ─── Slug resolution ───────────────────────────────────────────────────

	private toIdentity(row: FuelStationRow): StationIdentity {
		return {
			nodeId: row.nodeId,
			slug: row.slug ?? '',
			displayName: displayNameOf(row),
			tradingName: row.tradingName,
			brandName: row.brandName,
			address1: row.address1,
			address2: row.address2,
			city: row.city,
			country: row.country,
			postcode: row.postcode,
			latitude: row.latitude,
			longitude: row.longitude,
			isMotorwayService: row.isMotorwayService,
			isSupermarketService: row.isSupermarketService,
			temporarilyClosed: row.temporarilyClosed,
			permanentClosureDate: row.permanentClosureDate
		}
	}

	private async findStationBySlug(
		slug: string
	): Promise<FuelStationRow | null> {
		const exact = await this.db
			.select()
			.from(fuelStation)
			.where(eq(fuelStation.slug, slug))
			.limit(1)
		if (exact[0]) return exact[0]

		const token = extractSlugToken(slug)
		if (!token) return null
		const byToken = await this.db
			.select()
			.from(fuelStation)
			.where(like(fuelStation.slug, `%-${token}`))
			.limit(1)
		return byToken[0] ?? null
	}

	private async loadStation(nodeId: string): Promise<FuelStationRow | null> {
		const rows = await this.db
			.select()
			.from(fuelStation)
			.where(eq(fuelStation.nodeId, nodeId))
			.limit(1)
		return rows[0] ?? null
	}

	// ─── Per-station detail ─────────────────────────────────────────────────

	private async amenitiesFor(nodeId: string): Promise<string[]> {
		const rows = await this.db
			.select({
				code: stationAmenity.amenityCode,
				displayName: knownAmenity.displayName
			})
			.from(stationAmenity)
			.innerJoin(
				knownAmenity,
				eq(knownAmenity.amenityCode, stationAmenity.amenityCode)
			)
			.where(eq(stationAmenity.nodeId, nodeId))
			.orderBy(asc(stationAmenity.amenityCode))
		// Fall back to a prettified code until the LLM naming pass fills it in.
		return rows.map((row) => row.displayName ?? prettifyAmenityCode(row.code))
	}

	private async openingTimesFor(nodeId: string): Promise<StationOpeningTime[]> {
		const rows = await this.db
			.select({
				day: stationOpeningTime.day,
				openTime: stationOpeningTime.openTime,
				closeTime: stationOpeningTime.closeTime,
				is24Hours: stationOpeningTime.is24Hours
			})
			.from(stationOpeningTime)
			.where(eq(stationOpeningTime.nodeId, nodeId))
			.orderBy(asc(stationOpeningTime.day))
		return rows
	}

	/**
	 * Latest price per fuel type for a single station, merged with the set of
	 * fuel types the station is known to offer (so fuels with no recent price
	 * still appear, with a null price).
	 */
	private async currentPricesFor(
		nodeId: string
	): Promise<
		{ code: string; pricePence: number | null; timestamp: string | null }[]
	> {
		const latestPerType = this.db
			.select({
				typeCode: pricingEvent.typeCode,
				latestTimestamp: max(pricingEvent.timestamp).as('latestTimestamp')
			})
			.from(pricingEvent)
			.where(eq(pricingEvent.nodeId, nodeId))
			.groupBy(pricingEvent.typeCode)
			.as('latest_per_type')

		const priced = await this.db
			.select({
				code: pricingEvent.typeCode,
				pricePence: pricingEvent.pricePence,
				timestamp: pricingEvent.timestamp
			})
			.from(latestPerType)
			.innerJoin(
				pricingEvent,
				and(
					eq(pricingEvent.nodeId, nodeId),
					eq(pricingEvent.typeCode, latestPerType.typeCode),
					eq(pricingEvent.timestamp, latestPerType.latestTimestamp)
				)
			)

		const available = await this.db
			.select({ code: availableFuelType.typeCode })
			.from(availableFuelType)
			.where(eq(availableFuelType.nodeId, nodeId))

		const byCode = new Map<
			string,
			{ code: string; pricePence: number | null; timestamp: string | null }
		>()
		for (const row of priced) {
			byCode.set(row.code, {
				code: row.code,
				pricePence: row.pricePence,
				timestamp: toIso(row.timestamp)
			})
		}
		for (const row of available) {
			if (!byCode.has(row.code)) {
				byCode.set(row.code, {
					code: row.code,
					pricePence: null,
					timestamp: null
				})
			}
		}
		return [...byCode.values()]
	}

	// ─── Comparisons ─────────────────────────────────────────────────────────

	private latestPriceSubquery(fuelType: string, stationCondition: SQL) {
		return this.db
			.select({
				nodeId: pricingEvent.nodeId,
				latestTimestamp: max(pricingEvent.timestamp).as('latestTimestamp')
			})
			.from(pricingEvent)
			.innerJoin(fuelStation, eq(fuelStation.nodeId, pricingEvent.nodeId))
			.where(and(eq(pricingEvent.typeCode, fuelType), stationCondition))
			.groupBy(pricingEvent.nodeId)
			.as('latest_per_station')
	}

	/**
	 * Latest price for a set of stations across a set of fuel codes. Used to
	 * attach the headline-fuel pair (e.g. unleaded / diesel) to each
	 * comparison row. The input sets are small (≤ a handful of stations, ≤2
	 * codes), so a single grouped query suffices.
	 */
	private async latestPricesFor(
		nodeIds: string[],
		codes: string[]
	): Promise<Map<string, Map<string, number>>> {
		const result = new Map<string, Map<string, number>>()
		if (nodeIds.length === 0 || codes.length === 0) return result

		const latest = this.db
			.select({
				nodeId: pricingEvent.nodeId,
				typeCode: pricingEvent.typeCode,
				latestTimestamp: max(pricingEvent.timestamp).as('latestTimestamp')
			})
			.from(pricingEvent)
			.where(
				and(
					inArray(pricingEvent.nodeId, nodeIds),
					inArray(pricingEvent.typeCode, codes)
				)
			)
			.groupBy(pricingEvent.nodeId, pricingEvent.typeCode)
			.as('latest_per_node_type')

		const rows = await this.db
			.select({
				nodeId: pricingEvent.nodeId,
				typeCode: pricingEvent.typeCode,
				pricePence: pricingEvent.pricePence
			})
			.from(latest)
			.innerJoin(
				pricingEvent,
				and(
					eq(pricingEvent.nodeId, latest.nodeId),
					eq(pricingEvent.typeCode, latest.typeCode),
					eq(pricingEvent.timestamp, latest.latestTimestamp)
				)
			)

		for (const row of rows) {
			if (!row.nodeId) continue
			let byCode = result.get(row.nodeId)
			if (!byCode) {
				byCode = new Map()
				result.set(row.nodeId, byCode)
			}
			byCode.set(row.typeCode, row.pricePence)
		}
		return result
	}

	private async cheapestRaw(
		anchor: FuelStationRow,
		fuelType: string
	): Promise<RawComparisonRow[]> {
		const hasCoords = anchor.latitude !== null && anchor.longitude !== null
		// Prefer a geographic radius (same neighbourhood as "nearby") so small
		// towns still surface several real options; only fall back to exact-city
		// matching when the station has no coordinates at all.
		let stationCondition: SQL
		if (hasCoords) {
			const lat = anchor.latitude as number
			const lng = anchor.longitude as number
			stationCondition = and(
				gte(fuelStation.latitude, lat - NEARBY_BBOX_LAT_DELTA),
				lte(fuelStation.latitude, lat + NEARBY_BBOX_LAT_DELTA),
				gte(fuelStation.longitude, lng - NEARBY_BBOX_LNG_DELTA),
				lte(fuelStation.longitude, lng + NEARBY_BBOX_LNG_DELTA),
				eq(fuelStation.temporarilyClosed, false),
				isNull(fuelStation.permanentClosureDate),
				ne(fuelStation.nodeId, anchor.nodeId)
			) as SQL
		} else if (anchor.city) {
			stationCondition = and(
				eq(fuelStation.city, anchor.city),
				anchor.country ? eq(fuelStation.country, anchor.country) : undefined,
				eq(fuelStation.temporarilyClosed, false),
				isNull(fuelStation.permanentClosureDate),
				ne(fuelStation.nodeId, anchor.nodeId)
			) as SQL
		} else {
			return []
		}

		const latest = this.latestPriceSubquery(fuelType, stationCondition)
		const rows = await this.db
			.select({
				nodeId: fuelStation.nodeId,
				slug: fuelStation.slug,
				tradingName: fuelStation.tradingName,
				brandName: fuelStation.brandName,
				city: fuelStation.city,
				postcode: fuelStation.postcode,
				latitude: fuelStation.latitude,
				longitude: fuelStation.longitude,
				pricePence: pricingEvent.pricePence
			})
			.from(latest)
			.innerJoin(
				pricingEvent,
				and(
					eq(pricingEvent.nodeId, latest.nodeId),
					eq(pricingEvent.typeCode, fuelType),
					eq(pricingEvent.timestamp, latest.latestTimestamp)
				)
			)
			.innerJoin(fuelStation, eq(fuelStation.nodeId, latest.nodeId))
			.orderBy(asc(pricingEvent.pricePence), asc(fuelStation.nodeId))
			.limit(CHEAPEST_LIMIT)

		return rows.map((row) => ({
			nodeId: row.nodeId,
			slug: row.slug,
			displayName: displayNameOf(row),
			brandName: row.brandName,
			city: row.city,
			postcode: row.postcode,
			distanceKm:
				hasCoords && row.latitude !== null && row.longitude !== null
					? Math.round(
							haversineKm(
								anchor.latitude as number,
								anchor.longitude as number,
								row.latitude,
								row.longitude
							) * 10
						) / 10
					: null
		}))
	}

	private async nearbyRaw(
		anchor: FuelStationRow,
		fuelType: string
	): Promise<RawComparisonRow[]> {
		if (anchor.latitude === null || anchor.longitude === null) return []
		const { latitude: lat, longitude: lng } = anchor

		const stationCondition = and(
			gte(fuelStation.latitude, lat - NEARBY_BBOX_LAT_DELTA),
			lte(fuelStation.latitude, lat + NEARBY_BBOX_LAT_DELTA),
			gte(fuelStation.longitude, lng - NEARBY_BBOX_LNG_DELTA),
			lte(fuelStation.longitude, lng + NEARBY_BBOX_LNG_DELTA),
			eq(fuelStation.temporarilyClosed, false),
			isNull(fuelStation.permanentClosureDate),
			ne(fuelStation.nodeId, anchor.nodeId)
		) as SQL

		const latest = this.latestPriceSubquery(fuelType, stationCondition)
		// Cheap Manhattan-distance pre-filter in SQL; refined by true haversine
		// in JS over the (bounded) candidate set.
		const manhattan = sql<number>`abs(${fuelStation.latitude} - ${lat}) + abs(${fuelStation.longitude} - ${lng})`
		const rows = await this.db
			.select({
				nodeId: fuelStation.nodeId,
				slug: fuelStation.slug,
				tradingName: fuelStation.tradingName,
				brandName: fuelStation.brandName,
				city: fuelStation.city,
				postcode: fuelStation.postcode,
				latitude: fuelStation.latitude,
				longitude: fuelStation.longitude
			})
			.from(latest)
			.innerJoin(fuelStation, eq(fuelStation.nodeId, latest.nodeId))
			.orderBy(asc(manhattan))
			.limit(NEARBY_CANDIDATE_LIMIT)

		return rows
			.filter(
				(row): row is typeof row & { latitude: number; longitude: number } =>
					row.latitude !== null && row.longitude !== null
			)
			.map((row) => ({
				nodeId: row.nodeId,
				slug: row.slug,
				displayName: displayNameOf(row),
				brandName: row.brandName,
				city: row.city,
				postcode: row.postcode,
				distanceKm: haversineKm(lat, lng, row.latitude, row.longitude)
			}))
			.sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity))
			.slice(0, NEARBY_LIMIT)
			.map((row) => ({
				...row,
				distanceKm:
					row.distanceKm === null ? null : Math.round(row.distanceKm * 10) / 10
			}))
	}

	private async historyFor(
		nodeId: string,
		fuelType: string
	): Promise<PriceHistoryPoint[]> {
		const rows = await this.db
			.select({
				timestamp: pricingEvent.timestamp,
				pricePence: pricingEvent.pricePence
			})
			.from(pricingEvent)
			.where(
				and(
					eq(pricingEvent.nodeId, nodeId),
					eq(pricingEvent.typeCode, fuelType)
				)
			)
			.orderBy(asc(pricingEvent.timestamp))
			.limit(HISTORY_LIMIT)

		return rows.map((row) => ({
			timestamp: toIso(row.timestamp) as string,
			pricePence: row.pricePence
		}))
	}

	async getCompareData(
		anchor: FuelStationRow,
		fuelType: string
	): Promise<CompareData> {
		// The two-price pair shown on each comparison row mirrors the anchor's
		// forecourt sign (e.g. unleaded / diesel), so the columns mean the same
		// fuel across every row regardless of which tab is selected.
		const anchorFuels = decorateFuels(
			await this.currentPricesFor(anchor.nodeId)
		)
		const displayFuels = selectHeadlineFuels(anchorFuels).map((fuel) => ({
			code: fuel.code,
			label: fuel.label
		}))
		const displayCodes = displayFuels.map((fuel) => fuel.code)

		const [history, nearbyRows, cheapestRows] = await Promise.all([
			this.historyFor(anchor.nodeId, fuelType),
			this.nearbyRaw(anchor, fuelType),
			this.cheapestRaw(anchor, fuelType)
		])

		const allNodeIds = [
			...new Set([...nearbyRows, ...cheapestRows].map((row) => row.nodeId))
		]
		const priceMap = await this.latestPricesFor(allNodeIds, displayCodes)

		const attach = (rows: RawComparisonRow[]): ComparisonStation[] =>
			rows.map((row) => ({
				nodeId: row.nodeId,
				slug: row.slug,
				displayName: row.displayName,
				brandName: row.brandName,
				city: row.city,
				postcode: row.postcode,
				distanceKm: row.distanceKm,
				prices: displayFuels.map((fuel) => ({
					code: fuel.code,
					label: fuel.label,
					pricePence: priceMap.get(row.nodeId)?.get(fuel.code) ?? null
				}))
			}))

		return {
			fuelType,
			label: fuelLabel(fuelType),
			displayFuels,
			history,
			nearby: attach(nearbyRows),
			cheapest: attach(cheapestRows)
		}
	}

	/** Public RPC-facing variant that resolves the anchor by nodeId. */
	async getCompareDataByNodeId(nodeId: string, fuelType: string) {
		const anchor = await this.loadStation(nodeId)
		if (!anchor) return null
		return this.getCompareData(anchor, fuelType)
	}

	// ─── Page assembly ───────────────────────────────────────────────────────

	async getStationPage(slug: string): Promise<SlugResolution> {
		const row = await this.findStationBySlug(slug)
		if (!row || !row.slug) return { status: 'not_found' }
		if (row.slug !== slug) {
			return { status: 'redirect', canonicalSlug: row.slug }
		}

		const [rawPrices, amenities, openingTimes] = await Promise.all([
			this.currentPricesFor(row.nodeId),
			this.amenitiesFor(row.nodeId),
			this.openingTimesFor(row.nodeId)
		])

		const fuels = decorateFuels(rawPrices)
		const headline = selectHeadlineFuels(fuels)
		const defaultFuel = selectDefaultFuel(fuels)
		const compare = defaultFuel
			? await this.getCompareData(row, defaultFuel)
			: null

		const lastUpdated = fuels.reduce<string | null>((latest, fuel) => {
			if (!fuel.timestamp) return latest
			if (!latest || fuel.timestamp > latest) return fuel.timestamp
			return latest
		}, null)

		const payload: StationPagePayload = {
			station: this.toIdentity(row),
			amenities,
			openingTimes,
			fuels,
			headline,
			defaultFuel,
			compare,
			lastUpdated
		}
		return { status: 'ok', payload, canonicalSlug: row.slug }
	}

	// ─── Index listing ─────────────────────────────────────────────────────

	async listStations(options: {
		cursor: string | null
		query: string | null
		limit?: number
	}): Promise<StationListResult> {
		const limit = Math.min(options.limit ?? LIST_PAGE_SIZE, LIST_PAGE_SIZE)
		const nameExpr = sql<string>`coalesce(${fuelStation.tradingName}, ${fuelStation.brandName}, '')`

		const conditions: SQL[] = [isNotNull(fuelStation.slug)]

		const search = options.query?.trim()
		if (search) {
			const pattern = `%${search.replace(/[%_]/g, (m) => `\\${m}`)}%`
			conditions.push(
				or(
					like(fuelStation.tradingName, pattern),
					like(fuelStation.brandName, pattern),
					like(fuelStation.city, pattern),
					like(fuelStation.postcode, pattern)
				) as SQL
			)
		}

		const cursor = decodeCursor(options.cursor)
		const cursorName = cursor?.['name']
		const cursorNodeId = cursor?.['nodeId']
		if (typeof cursorName === 'string' && typeof cursorNodeId === 'string') {
			conditions.push(
				or(
					gt(nameExpr, cursorName),
					and(eq(nameExpr, cursorName), gt(fuelStation.nodeId, cursorNodeId))
				) as SQL
			)
		}

		const rows = await this.db
			.select({
				nodeId: fuelStation.nodeId,
				slug: fuelStation.slug,
				name: nameExpr,
				tradingName: fuelStation.tradingName,
				brandName: fuelStation.brandName,
				city: fuelStation.city,
				postcode: fuelStation.postcode
			})
			.from(fuelStation)
			.where(and(...conditions))
			.orderBy(asc(nameExpr), asc(fuelStation.nodeId))
			.limit(limit + 1)

		const hasMore = rows.length > limit
		const page = rows.slice(0, limit)
		const last = page[page.length - 1]
		const nextCursor =
			hasMore && last
				? encodeCursor({ name: last.name, nodeId: last.nodeId })
				: null

		return {
			items: page.map((row) => ({
				nodeId: row.nodeId,
				slug: row.slug ?? '',
				displayName: displayNameOf(row),
				brandName: row.brandName,
				city: row.city,
				postcode: row.postcode
			})),
			nextCursor
		}
	}

	// ─── Sitemap ──────────────────────────────────────────────────────────

	async listSlugsForSitemap(cursor: string | null): Promise<SitemapResult> {
		const decoded = decodeCursor(cursor)
		const decodedNodeId = decoded?.['nodeId']
		const afterNodeId = typeof decodedNodeId === 'string' ? decodedNodeId : null

		const conditions: SQL[] = [isNotNull(fuelStation.slug)]
		if (afterNodeId) conditions.push(gt(fuelStation.nodeId, afterNodeId))

		const rows = await this.db
			.select({ nodeId: fuelStation.nodeId, slug: fuelStation.slug })
			.from(fuelStation)
			.where(and(...conditions))
			.orderBy(asc(fuelStation.nodeId))
			.limit(SITEMAP_PAGE_SIZE + 1)

		const hasMore = rows.length > SITEMAP_PAGE_SIZE
		const page = rows.slice(0, SITEMAP_PAGE_SIZE)
		const nodeIds = page.map((row) => row.nodeId)

		const lastmodByNodeId = new Map<string, string>()
		const chunkSize = Math.max(1, MAX_SQLITE_VARS_PER_STATEMENT)
		for (let i = 0; i < nodeIds.length; i += chunkSize) {
			const chunk = nodeIds.slice(i, i + chunkSize)
			const maxRows = await this.db
				.select({
					nodeId: pricingEvent.nodeId,
					latest: max(pricingEvent.timestamp).as('latest')
				})
				.from(pricingEvent)
				.where(inArray(pricingEvent.nodeId, chunk))
				.groupBy(pricingEvent.nodeId)
			for (const row of maxRows) {
				const iso = toIso(row.latest)
				if (row.nodeId && iso) lastmodByNodeId.set(row.nodeId, iso)
			}
		}

		const last = page[page.length - 1]
		return {
			items: page.map((row) => ({
				slug: row.slug ?? '',
				lastmod: lastmodByNodeId.get(row.nodeId) ?? null
			})),
			nextCursor: hasMore && last ? encodeCursor({ nodeId: last.nodeId }) : null
		}
	}
}
