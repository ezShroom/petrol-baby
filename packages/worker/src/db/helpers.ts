import { getTableColumns, SQL, sql, type Column } from 'drizzle-orm'
import type { SQLiteTable, TableConfig } from 'drizzle-orm/sqlite-core'

/**
 * Builds a `SET` clause that maps every column to its `excluded.*`
 * counterpart for use in `onConflictDoUpdate`.
 *
 * @param exclude - columns to omit (typically the conflict target).
 *   Including the conflict target in SET is wasteful at best and can
 *   trigger spurious ON UPDATE CASCADE evaluation in SQLite.
 */
export function setAll<T extends TableConfig>(
	table: SQLiteTable<T>,
	{ exclude }: { exclude?: Column[] } = {}
): Partial<{ [K in keyof T['columns']]: SQL }> {
	const cols = getTableColumns(table)
	const excludeNames = new Set(exclude?.map((c) => c.name))
	const entries = (Object.keys(cols) as Array<keyof T['columns']>)
		.filter((columnName) => {
			const col = cols[columnName]
			return col && !excludeNames.has(col.name)
		})
		.map((columnName) => {
			const col = cols[columnName]
			if (!col) throw new Error(`Column ${String(columnName)} not found`)
			return [columnName, sql.raw(`excluded.${col.name}`)] as const
		})
	return Object.fromEntries(entries) as Partial<{
		[K in keyof T['columns']]: SQL
	}>
}
