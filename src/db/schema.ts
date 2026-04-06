import type { DataRegion } from '@/types/DataRegion'
import { StationOpeningDay } from '@/types/StationOpeningDay'
import {
	integer,
	primaryKey,
	real,
	sqliteTable,
	text
} from 'drizzle-orm/sqlite-core'
import { KeyType } from '../types/KeyType'

export const key = sqliteTable('key', {
	type: integer().primaryKey().$type<KeyType>(),
	key: text().notNull(),
	expires: integer({ mode: 'timestamp' })
})
export const fuelStation = sqliteTable('fuel_station', {
	nodeId: text().primaryKey(),
	phone: text(),
	tradingName: text(),
	brandName: text(),
	temporarilyClosed: integer({ mode: 'boolean' }),
	permanentlyClosed: integer({ mode: 'boolean' }),
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
	sourceHash: text()
})
export const knownType = sqliteTable('known_type', {
	typeCode: text().primaryKey()
})
export const availableFuelType = sqliteTable('available_fuel_type', {
	associationId: text().primaryKey().$default(crypto.randomUUID),
	nodeId: text()
		.references(() => fuelStation.nodeId, {
			onDelete: 'cascade',
			onUpdate: 'cascade'
		})
		.notNull(),
	typeCode: text()
		.references(() => knownType.typeCode)
		.notNull()
})
export const pricingEvent = sqliteTable('pricing_event', {
	nodeId: text().references(() => fuelStation.nodeId, {
		onDelete: 'cascade',
		onUpdate: 'cascade'
	}),
	typeCode: text()
		.references(() => knownType.typeCode)
		.notNull(),
	timestamp: integer({ mode: 'timestamp' }).notNull(),
	pricePence: real().notNull()
})
export const knownAmenity = sqliteTable('known_amenity', {
	amenityCode: text().primaryKey()
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
	backfilledAt: integer({ mode: 'timestamp' }).notNull(),
	lastUpdatedAt: integer({ mode: 'timestamp' })
})
