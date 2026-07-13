import {
	index,
	integer,
	primaryKey,
	real,
	sqliteTable,
	text,
	uniqueIndex
} from 'drizzle-orm/sqlite-core'
import type { DataRegion } from '../types/DataRegion'
import { KeyType } from '../types/KeyType'
import { StationOpeningDay } from '../types/StationOpeningDay'

export const key = sqliteTable('key', {
	type: integer().primaryKey().$type<KeyType>(),
	key: text().notNull(),
	expires: integer({ mode: 'timestamp' })
})
export const fuelStation = sqliteTable(
	'fuel_station',
	{
		nodeId: text().primaryKey(),
		phone: text(),
		tradingName: text(),
		brandName: text(),
		temporarilyClosed: integer({ mode: 'boolean' }),
		isMotorwayService: integer({ mode: 'boolean' }),
		isSupermarketService: integer({ mode: 'boolean' }),
		address1: text(),
		address2: text(),
		city: text(),
		country: text(),
		postcode: text(),
		latitude: real(),
		longitude: real(),
		permanentClosureDate: text(),
		coordinatesValid: integer({ mode: 'boolean' }),
		sourceHash: text(),
		// Human-readable, collision-proof URL slug for the public web pages,
		// e.g. `asda-hollingbury-brighton-k7f2a9`.  The trailing token is
		// derived from the immutable nodeId, so the slug is stable and unique.
		slug: text()
	},
	(table) => [
		index('fuel_station_postcode_idx').on(table.postcode),
		index('fuel_station_country_idx').on(table.country),
		index('fuel_station_city_idx').on(table.city),
		index('fuel_station_brand_name_idx').on(table.brandName),
		uniqueIndex('fuel_station_slug_idx').on(table.slug),
		index('fuel_station_lat_lng_idx').on(table.latitude, table.longitude)
	]
)
export const knownType = sqliteTable('known_type', {
	typeCode: text().primaryKey()
})
export const availableFuelType = sqliteTable(
	'available_fuel_type',
	{
		nodeId: text()
			.references(() => fuelStation.nodeId, {
				onDelete: 'cascade',
				onUpdate: 'cascade'
			})
			.notNull(),
		typeCode: text()
			.references(() => knownType.typeCode)
			.notNull()
	},
	(table) => [primaryKey({ columns: [table.nodeId, table.typeCode] })]
)
export const pricingEvent = sqliteTable(
	'pricing_event',
	{
		nodeId: text().references(() => fuelStation.nodeId, {
			onDelete: 'cascade',
			onUpdate: 'cascade'
		}),
		typeCode: text()
			.references(() => knownType.typeCode)
			.notNull(),
		timestamp: integer({ mode: 'timestamp_ms' }).notNull(),
		pricePence: real().notNull()
	},
	(table) => [
		primaryKey({ columns: [table.nodeId, table.typeCode, table.timestamp] }),
		index('pricing_event_type_code_node_id_timestamp_idx').on(
			table.typeCode,
			table.nodeId,
			table.timestamp
		)
	]
)
export const knownAmenity = sqliteTable('known_amenity', {
	amenityCode: text().primaryKey(),
	// Human-friendly label (e.g. `adblue_packaged` -> `AdBlue Packaged`),
	// generated once via an LLM and cached forever. Null until processed.
	displayName: text()
})
export const stationAmenity = sqliteTable(
	'station_amenity',
	{
		nodeId: text()
			.references(() => fuelStation.nodeId, {
				onDelete: 'cascade',
				onUpdate: 'cascade'
			})
			.notNull(),
		amenityCode: text()
			.references(() => knownAmenity.amenityCode)
			.notNull()
	},
	(table) => [primaryKey({ columns: [table.nodeId, table.amenityCode] })]
)
export const stationOpeningTime = sqliteTable(
	'station_opening_time',
	{
		nodeId: text()
			.references(() => fuelStation.nodeId, {
				onDelete: 'cascade',
				onUpdate: 'cascade'
			})
			.notNull(),
		day: integer().notNull().$type<StationOpeningDay>(),
		openTime: text().notNull(),
		closeTime: text().notNull(),
		is24Hours: integer({ mode: 'boolean' }).notNull()
	},
	(table) => [primaryKey({ columns: [table.nodeId, table.day] })]
)
export const potentialDuplicate = sqliteTable(
	'potential_duplicate',
	{
		sourceNodeId: text()
			.references(() => fuelStation.nodeId, {
				onDelete: 'cascade',
				onUpdate: 'cascade'
			})
			.notNull(),
		targetNodeId: text()
			.references(() => fuelStation.nodeId, {
				onDelete: 'cascade',
				onUpdate: 'cascade'
			})
			.notNull()
	},
	(table) => [primaryKey({ columns: [table.sourceNodeId, table.targetNodeId] })]
)
export const dataMetadata = sqliteTable('data_metadata', {
	region: integer().primaryKey().$type<DataRegion>(),
	backfilledAt: integer({ mode: 'timestamp' })
		.$default(() => new Date())
		.notNull(),
	lastUpdatedAt: integer({ mode: 'timestamp' })
		.$default(() => new Date())
		.notNull()
})
