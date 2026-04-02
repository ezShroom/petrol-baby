import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { KeyType } from '../types/KeyType'
import type { DataRegion } from '@/types/DataRegion'

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
	matchingNames: integer({ mode: 'boolean' }),
	temporarilyClosed: integer({ mode: 'boolean' }),
	permanentlyClosed: integer({ mode: 'boolean' }),
	isMotorwayService: integer({ mode: 'boolean' }),
	isSupermarketService: integer({ mode: 'boolean' }),
	address1: text(),
	address2: text(),
	city: text(),
	country: text(),
	county: text(),
	postcode: text(),
	latitude: real(),
	longitude: real()
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
export const dataMetadata = sqliteTable('data_metadata', {
	region: integer().primaryKey().$type<DataRegion>(),
	backfilledAt: integer({ mode: 'timestamp' }).notNull(),
	lastUpdatedAt: integer({ mode: 'timestamp' })
})
