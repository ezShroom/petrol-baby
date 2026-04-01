import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { KeyType } from '../types/KeyType'

export const keys = sqliteTable('keys', {
	type: integer().primaryKey().$type<KeyType>(),
	key: text().notNull(),
	expires: integer({ mode: 'timestamp' })
})
