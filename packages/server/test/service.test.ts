import { afterEach, describe, expect, test } from 'bun:test'
import { ms } from 'ms'
import {
	dataMetadata,
	fuelStation,
	knownType,
	pricingEvent
} from '../src/db/schema'
import { PetrolBabyService } from '../src/service'
import { DataRegion } from '../src/types/DataRegion'
import { tempDatabasePath, testConfig } from './helpers'

type ServiceInternals = {
	pruneOldPricingEvents(): Promise<void>
	startMaintenance(
		kind: 'backfill' | 'scheduled',
		runner: () => Promise<void>
	): Promise<void> | null
}

function internals(service: PetrolBabyService): ServiceInternals {
	return service as unknown as ServiceInternals
}

describe('PetrolBabyService', () => {
	const cleanups: (() => Promise<void> | void)[] = []
	afterEach(async () => {
		for (const cleanup of cleanups.splice(0)) await cleanup()
	})

	function createService(): PetrolBabyService {
		const { path, cleanup } = tempDatabasePath()
		const service = new PetrolBabyService(testConfig(path))
		cleanups.push(async () => {
			await service.close()
			cleanup()
		})
		return service
	}

	async function seedStation(service: PetrolBabyService, nodeId: string) {
		await service.db.insert(fuelStation).values({ nodeId })
	}

	test('reports healthy but not ready on a fresh database', async () => {
		const service = createService()
		expect(service.checkHealth()).toBe(true)
		expect(await service.isReady()).toBe(false)
		await expect(service.ensurePriceQueryDataReady()).rejects.toThrow(
			/still being backfilled/
		)
	})

	test('becomes ready once both regions have metadata', async () => {
		const service = createService()
		const now = new Date()
		await service.db.insert(dataMetadata).values([
			{ region: DataRegion.Stations, backfilledAt: now, lastUpdatedAt: now },
			{ region: DataRegion.Prices, backfilledAt: now, lastUpdatedAt: now }
		])
		expect(await service.isReady()).toBe(true)
		await service.ensurePriceQueryDataReady()
	})

	test('prune deletes old events but always keeps the latest per station/fuel', async () => {
		const service = createService()
		await seedStation(service, 's1')
		await service.db.insert(knownType).values({ typeCode: 'unleaded' })

		const now = Date.now()
		const old = (days: number) => new Date(now - ms('1d') * days)

		await service.db.insert(pricingEvent).values([
			// Only event for this pair is ancient — must survive.
			{
				nodeId: 's1',
				typeCode: 'unleaded',
				timestamp: old(30),
				pricePence: 150
			},
			// A second, even older event for the same pair — must go.
			{
				nodeId: 's1',
				typeCode: 'unleaded',
				timestamp: old(40),
				pricePence: 155
			},
			// Recent event — must survive.
			{ nodeId: 's1', typeCode: 'unleaded', timestamp: old(1), pricePence: 140 }
		])

		await internals(service).pruneOldPricingEvents()

		const remaining = await service.db.select().from(pricingEvent)
		const times = remaining.map((row) => row.timestamp.getTime()).sort()
		// The 40-day-old row is gone; the 30-day-old row is gone too because a
		// newer (1-day-old) event exists for the pair; the latest survives.
		expect(remaining).toHaveLength(1)
		expect(times[0]).toBe(old(1).getTime())
	})

	test('prune keeps a stale latest event so stations never lose their last price', async () => {
		const service = createService()
		await seedStation(service, 's2')
		await service.db.insert(knownType).values({ typeCode: 'diesel' })

		const old = new Date(Date.now() - ms('1d') * 60)
		await service.db
			.insert(pricingEvent)
			.values([
				{ nodeId: 's2', typeCode: 'diesel', timestamp: old, pricePence: 160 }
			])

		await internals(service).pruneOldPricingEvents()

		const remaining = await service.db.select().from(pricingEvent)
		expect(remaining).toHaveLength(1)
	})

	test('maintenance lock rejects overlapping runs', async () => {
		const service = createService()

		let release!: () => void
		const gate = new Promise<void>((resolve) => {
			release = resolve
		})

		const first = internals(service).startMaintenance('scheduled', () => gate)
		expect(first).not.toBeNull()

		const second = internals(service).startMaintenance(
			'scheduled',
			async () => {}
		)
		expect(second).toBeNull()

		release()
		await first

		// After the first run settles, a new run may start.
		const third = internals(service).startMaintenance(
			'scheduled',
			async () => {}
		)
		expect(third).not.toBeNull()
		await third
	})

	test('scheduled maintenance on an unbackfilled database is a safe no-op', async () => {
		const service = createService()
		// Would throw if it tried to reach the (unreachable) Fuel Finder API.
		await service.runScheduledMaintenance()
		expect(await service.isReady()).toBe(false)
	})

	test('backupTo produces a valid standalone snapshot', async () => {
		const service = createService()
		await seedStation(service, 'backup-station')

		const { path, cleanup } = tempDatabasePath()
		cleanups.push(cleanup)
		service.backupTo(path)

		const { Database } = await import('bun:sqlite')
		const snapshot = new Database(path, { readonly: true })
		const count = snapshot
			.query<{ n: number }, []>('SELECT count(*) AS n FROM fuel_station')
			.get()
		snapshot.close()
		expect(count?.n).toBe(1)
	})
})
