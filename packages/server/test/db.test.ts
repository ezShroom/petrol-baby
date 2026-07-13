import { afterEach, describe, expect, test } from 'bun:test'
import { openDatabase, verifyDatabase } from '../src/db/client'
import { fuelStation, pricingEvent } from '../src/db/schema'
import { tempDatabasePath } from './helpers'

describe('openDatabase', () => {
	const cleanups: (() => void)[] = []
	afterEach(() => {
		for (const cleanup of cleanups.splice(0)) cleanup()
	})

	function open() {
		const { path, cleanup } = tempDatabasePath()
		cleanups.push(cleanup)
		const handles = openDatabase(path)
		cleanups.push(() => handles.sqlite.close(false))
		return handles
	}

	test('applies migrations to an empty database and passes verification', () => {
		const { sqlite } = open()

		const tables = sqlite
			.query<{ name: string }, []>(
				"SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
			)
			.all()
			.map((row) => row.name)

		expect(tables).toEqual(
			expect.arrayContaining([
				'available_fuel_type',
				'data_metadata',
				'fuel_station',
				'key',
				'known_amenity',
				'known_type',
				'potential_duplicate',
				'pricing_event',
				'station_amenity',
				'station_opening_time'
			])
		)

		verifyDatabase(sqlite)
	})

	test('sets WAL journal mode and enables foreign keys', () => {
		const { sqlite } = open()

		const journal = sqlite
			.query<{ journal_mode: string }, []>('PRAGMA journal_mode;')
			.get()
		expect(journal?.journal_mode).toBe('wal')

		const fk = sqlite
			.query<{ foreign_keys: number }, []>('PRAGMA foreign_keys;')
			.get()
		expect(fk?.foreign_keys).toBe(1)
	})

	test('is idempotent: reopening an existing database applies nothing new', () => {
		const { path, cleanup } = tempDatabasePath()
		cleanups.push(cleanup)

		const first = openDatabase(path)
		first.sqlite.close(false)
		const second = openDatabase(path)
		cleanups.push(() => second.sqlite.close(false))

		verifyDatabase(second.sqlite)
	})

	test('enforces foreign keys on pricing events', async () => {
		const { db } = open()

		// No station with this nodeId exists, so the FK must reject the row.
		// (Wrapped in an IIFE because drizzle queries are thenables, and
		// bun:test's `.rejects` insists on a real Promise.)
		await expect(
			(async () => {
				await db.insert(pricingEvent).values({
					nodeId: 'missing-station',
					typeCode: 'also-missing',
					timestamp: new Date(),
					pricePence: 139.9
				})
			})()
		).rejects.toThrow(/FOREIGN KEY/i)

		await db.insert(fuelStation).values({ nodeId: 'station-1' })
		const rows = await db.select().from(fuelStation)
		expect(rows).toHaveLength(1)
	})
})
