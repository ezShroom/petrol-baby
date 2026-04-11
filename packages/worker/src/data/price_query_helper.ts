import {
	and,
	asc,
	eq,
	exists,
	inArray,
	isNull,
	like,
	or,
	type SQL
} from 'drizzle-orm'
import type { DrizzleSqliteDODatabase } from 'drizzle-orm/durable-sqlite'
import { max } from 'drizzle-orm/sql/functions/aggregate'
import { MAX_SQLITE_VARS_PER_STATEMENT } from '../constants'
import {
	availableFuelType,
	fuelStation,
	knownAmenity,
	knownType,
	pricingEvent,
	stationAmenity
} from '../db/schema'
import type { NormalizedPriceQuery } from '../types/NormalizedPriceQuery'
import type { StationPriceResult } from '../types/StationPriceResult'

type StationPriceSqlRow = {
	nodeId: string
	tradingName: string | null
	brandName: string | null
	address1: string | null
	address2: string | null
	city: string | null
	country: string | null
	postcode: string | null
	pricePence: number
	priceTimestamp: Date | number | string
}

function toIsoTimestamp(timestamp: Date | number | string): string {
	return (
		timestamp instanceof Date ? timestamp : new Date(Number(timestamp))
	).toISOString()
}

export class PriceQueryHelper {
	constructor(
		private readonly db: DrizzleSqliteDODatabase<Record<string, unknown>>
	) {}

	async listKnownCodes(
		tableName: 'known_amenity' | 'known_type'
	): Promise<string[]> {
		const rows =
			tableName === 'known_amenity'
				? await this.db
						.select({ code: knownAmenity.amenityCode })
						.from(knownAmenity)
						.orderBy(asc(knownAmenity.amenityCode))
				: await this.db
						.select({ code: knownType.typeCode })
						.from(knownType)
						.orderBy(asc(knownType.typeCode))

		return rows.map((row) => row.code)
	}

	private buildAreaCondition(query: NormalizedPriceQuery): SQL | undefined {
		const areaConditions = query.areas
			.map((area) => {
				switch (area.scope) {
					case 'all_uk':
						return null
					case 'country':
						return eq(fuelStation.country, area.country)
					case 'city':
						return area.country
							? and(
									eq(fuelStation.city, area.city),
									eq(fuelStation.country, area.country)
								)
							: eq(fuelStation.city, area.city)
					case 'postcode':
						return eq(fuelStation.postcode, area.postcode)
					case 'postcode_prefix':
						return like(fuelStation.postcode, `${area.prefix}%`)
				}
			})
			.filter((condition): condition is SQL => condition !== null)

		return areaConditions.length > 0 ? or(...areaConditions) : undefined
	}

	async queryCurrentPriceRows(
		query: NormalizedPriceQuery,
		limit?: number
	): Promise<StationPriceSqlRow[]> {
		const latestPerStation = this.db
			.select({
				nodeId: pricingEvent.nodeId,
				latestTimestamp: max(pricingEvent.timestamp).as('latestTimestamp')
			})
			.from(pricingEvent)
			.where(eq(pricingEvent.typeCode, query.fuelType))
			.groupBy(pricingEvent.nodeId)
			.as('latest_per_station')

		const conditions: SQL[] = []
		const areaCondition = this.buildAreaCondition(query)
		if (areaCondition) conditions.push(areaCondition)
		if (!query.includeClosed) {
			conditions.push(eq(fuelStation.temporarilyClosed, false))
			conditions.push(isNull(fuelStation.permanentClosureDate))
		}
		if (query.station?.nodeId)
			conditions.push(eq(fuelStation.nodeId, query.station.nodeId))
		if (query.station?.tradingName) {
			conditions.push(eq(fuelStation.tradingName, query.station.tradingName))
		}
		if (query.station?.brandName) {
			conditions.push(eq(fuelStation.brandName, query.station.brandName))
		}
		if (query.station?.postcode) {
			conditions.push(eq(fuelStation.postcode, query.station.postcode))
		}
		for (const amenity of query.amenities) {
			conditions.push(
				exists(
					this.db
						.select({ value: stationAmenity.nodeId })
						.from(stationAmenity)
						.where(
							and(
								eq(stationAmenity.nodeId, fuelStation.nodeId),
								eq(stationAmenity.amenityCode, amenity)
							)
						)
				)
			)
		}
		for (const typeCode of query.availableFuelTypes) {
			conditions.push(
				exists(
					this.db
						.select({ value: availableFuelType.nodeId })
						.from(availableFuelType)
						.where(
							and(
								eq(availableFuelType.nodeId, fuelStation.nodeId),
								eq(availableFuelType.typeCode, typeCode)
							)
						)
				)
			)
		}

		let statement = this.db
			.select({
				nodeId: fuelStation.nodeId,
				tradingName: fuelStation.tradingName,
				brandName: fuelStation.brandName,
				address1: fuelStation.address1,
				address2: fuelStation.address2,
				city: fuelStation.city,
				country: fuelStation.country,
				postcode: fuelStation.postcode,
				pricePence: pricingEvent.pricePence,
				priceTimestamp: pricingEvent.timestamp
			})
			.from(pricingEvent)
			.innerJoin(
				latestPerStation,
				and(
					eq(pricingEvent.nodeId, latestPerStation.nodeId),
					eq(pricingEvent.timestamp, latestPerStation.latestTimestamp)
				)
			)
			.innerJoin(fuelStation, eq(fuelStation.nodeId, pricingEvent.nodeId))
			.where(and(eq(pricingEvent.typeCode, query.fuelType), ...conditions))
			.orderBy(
				asc(pricingEvent.pricePence),
				asc(fuelStation.tradingName),
				asc(fuelStation.nodeId)
			)
			.$dynamic()

		if (typeof limit === 'number') {
			statement = statement.limit(limit)
		}

		return statement
	}

	private async loadRelationValues(
		nodeIds: string[],
		relation: 'amenity' | 'fuel_type'
	): Promise<Map<string, string[]>> {
		const relationMap = new Map<string, string[]>()
		if (nodeIds.length === 0) {
			return relationMap
		}

		const chunkSize = Math.max(1, MAX_SQLITE_VARS_PER_STATEMENT)
		for (let i = 0; i < nodeIds.length; i += chunkSize) {
			const chunk = nodeIds.slice(i, i + chunkSize)
			const rows =
				relation === 'amenity'
					? await this.db
							.select({
								nodeId: stationAmenity.nodeId,
								relationValue: stationAmenity.amenityCode
							})
							.from(stationAmenity)
							.where(inArray(stationAmenity.nodeId, chunk))
							.orderBy(asc(stationAmenity.amenityCode))
					: await this.db
							.select({
								nodeId: availableFuelType.nodeId,
								relationValue: availableFuelType.typeCode
							})
							.from(availableFuelType)
							.where(inArray(availableFuelType.nodeId, chunk))
							.orderBy(asc(availableFuelType.typeCode))

			for (const row of rows) {
				const existing = relationMap.get(row.nodeId)
				if (existing) {
					existing.push(row.relationValue)
				} else {
					relationMap.set(row.nodeId, [row.relationValue])
				}
			}
		}

		return relationMap
	}

	async hydrateStationPriceRows(
		query: NormalizedPriceQuery,
		rows: StationPriceSqlRow[]
	): Promise<StationPriceResult[]> {
		if (rows.length === 0) {
			return []
		}

		const nodeIds = [...new Set(rows.map((row) => row.nodeId))]
		const [amenitiesByNodeId, fuelTypesByNodeId] = await Promise.all([
			this.loadRelationValues(nodeIds, 'amenity'),
			this.loadRelationValues(nodeIds, 'fuel_type')
		])

		return rows.map((row) => ({
			nodeId: row.nodeId,
			tradingName: row.tradingName,
			brandName: row.brandName,
			address1: row.address1,
			address2: row.address2,
			city: row.city,
			country: row.country,
			postcode: row.postcode,
			pricePence: row.pricePence,
			fuelType: query.fuelType,
			priceTimestamp: toIsoTimestamp(row.priceTimestamp),
			amenities: amenitiesByNodeId.get(row.nodeId) ?? [],
			availableFuelTypes: fuelTypesByNodeId.get(row.nodeId) ?? []
		}))
	}
}
