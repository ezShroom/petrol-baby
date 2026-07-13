import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Database } from 'bun:sqlite'
import { drizzle, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'

/**
 * The application-wide database handle type. Query helpers accept this
 * instead of a driver-specific type so the schema stays the only coupling.
 */
export type AppDatabase = BunSQLiteDatabase<Record<string, unknown>>

export type OpenDatabaseResult = {
	db: AppDatabase
	sqlite: Database
}

/**
 * Resolved relative to this source file, not the working directory, so the
 * migrator finds the SQL regardless of where the process was started. The
 * server package always runs as source under Bun (it is externalized from
 * the SvelteKit bundle), so this path exists in every deployment.
 */
const MIGRATIONS_FOLDER = fileURLToPath(
	new URL('./migrations', import.meta.url)
)

/**
 * Open (creating if necessary) the SQLite database, apply the standard
 * pragmas, and run any pending migrations. Every process that touches the
 * database — web service, backfill CLI, backup CLI, tests — must go through
 * this function so connection settings never diverge.
 */
export function openDatabase(path: string): OpenDatabaseResult {
	if (path !== ':memory:') {
		mkdirSync(dirname(path), { recursive: true })
	}

	const sqlite = new Database(path, { create: true })

	// WAL lets readers proceed while a write transaction is open, which keeps
	// page renders responsive during maintenance ticks. foreign_keys is off by
	// default in SQLite and must be enabled per connection.
	sqlite.run('PRAGMA journal_mode = WAL;')
	sqlite.run('PRAGMA foreign_keys = ON;')
	sqlite.run('PRAGMA busy_timeout = 5000;')
	sqlite.run('PRAGMA synchronous = NORMAL;')

	const db = drizzle(sqlite, { logger: false })
	migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })

	return { db, sqlite }
}

/** Run SQLite's integrity and foreign-key checks; throws on any failure. */
export function verifyDatabase(sqlite: Database): void {
	const integrity = sqlite
		.query<{ integrity_check: string }, []>('PRAGMA integrity_check;')
		.get()
	if (integrity?.integrity_check !== 'ok') {
		throw new Error(
			`SQLite integrity check failed: ${JSON.stringify(integrity)}`
		)
	}

	const fkViolations = sqlite.query('PRAGMA foreign_key_check;').all()
	if (fkViolations.length > 0) {
		throw new Error(
			`SQLite foreign key check failed: ${JSON.stringify(fkViolations.slice(0, 10))}`
		)
	}
}
