/**
 * Consistent SQLite snapshot via `VACUUM INTO`.
 *
 *   bun run data:backup [destinationDir]
 *
 * The destination directory defaults to $BACKUP_DIR or, failing that,
 * `<database directory>/backups`. Old snapshots beyond BACKUP_RETAIN
 * (default 7) are deleted, oldest first. The snapshot is a complete,
 * standalone database file — restore by pointing DATABASE_PATH at a copy of
 * it.
 *
 * The database contains persisted Fuel Finder OAuth tokens, so keep the
 * backup directory as tightly permissioned as the database itself, and copy
 * snapshots off the host (this script deliberately doesn't pick a cloud).
 */
import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Database } from 'bun:sqlite'
import { loadConfig } from '../config'

const config = loadConfig()
const retainRaw = process.env['BACKUP_RETAIN']?.trim()
const retain = retainRaw ? Number.parseInt(retainRaw, 10) : 7
if (!Number.isInteger(retain) || retain < 1) {
	console.error(`BACKUP_RETAIN must be a positive integer (got "${retainRaw}")`)
	process.exit(1)
}

const destinationDir =
	process.argv[2] ??
	process.env['BACKUP_DIR'] ??
	join(dirname(config.databasePath), 'backups')

mkdirSync(destinationDir, { recursive: true, mode: 0o700 })

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const destination = join(destinationDir, `petrol-baby-${stamp}.sqlite`)

// A dedicated connection so we don't touch the running service. busy_timeout
// lets the snapshot wait politely for any in-flight write transaction.
const sqlite = new Database(config.databasePath, { readwrite: true })
sqlite.run('PRAGMA busy_timeout = 30000;')

console.log(`Backing up ${config.databasePath} -> ${destination}`)
sqlite.run('VACUUM INTO ?', [destination])

// Sanity-check the snapshot before pruning anything.
const snapshot = new Database(destination, { readonly: true })
const integrity = snapshot
	.query<{ integrity_check: string }, []>('PRAGMA integrity_check;')
	.get()
snapshot.close()
if (integrity?.integrity_check !== 'ok') {
	console.error(`Snapshot failed integrity check: ${JSON.stringify(integrity)}`)
	unlinkSync(destination)
	process.exit(1)
}

sqlite.close()

// Retention: keep the newest `retain` snapshots.
const snapshots = readdirSync(destinationDir)
	.filter((name) => /^petrol-baby-.*\.sqlite$/.test(name))
	.map((name) => ({
		name,
		path: join(destinationDir, name),
		mtime: statSync(join(destinationDir, name)).mtimeMs
	}))
	.sort((a, b) => b.mtime - a.mtime)

for (const old of snapshots.slice(retain)) {
	console.log(`Pruning old backup ${old.name}`)
	unlinkSync(old.path)
}

console.log(
	`Backup complete (${snapshots.length <= retain ? snapshots.length : retain} snapshots retained).`
)
