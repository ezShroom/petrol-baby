import { describe, expect, test } from 'bun:test'
import { loadConfig } from '../src/config'
import { mapWithConcurrency } from '../src/util/concurrency'

describe('loadConfig', () => {
	const base = {
		DATABASE_PATH: '/tmp/petrol-baby-test.sqlite',
		FUEL_FINDER_CLIENT_ID: 'id',
		FUEL_FINDER_CLIENT_SECRET: 'secret'
	}

	test('loads defaults', () => {
		const config = loadConfig(base)
		expect(config.fuelFinderBaseUrl).toBe(
			'https://www.fuel-finder.service.gov.uk/api'
		)
		expect(config.llmConcurrency).toBe(3)
		expect(config.openRouterApiKey).toBeUndefined()
	})

	test('rejects missing required variables', () => {
		expect(() => loadConfig({ ...base, DATABASE_PATH: '' })).toThrow(
			/DATABASE_PATH/
		)
		expect(() =>
			loadConfig({ ...base, FUEL_FINDER_CLIENT_ID: undefined })
		).toThrow(/FUEL_FINDER_CLIENT_ID/)
	})

	test('rejects relative database paths', () => {
		expect(() => loadConfig({ ...base, DATABASE_PATH: 'db.sqlite' })).toThrow(
			/absolute path/
		)
	})

	test('strips trailing slashes from base URL overrides', () => {
		const config = loadConfig({
			...base,
			FUEL_FINDER_BASE_URL: 'https://example.com/api///'
		})
		expect(config.fuelFinderBaseUrl).toBe('https://example.com/api')
	})

	test('validates LLM_CONCURRENCY', () => {
		expect(() => loadConfig({ ...base, LLM_CONCURRENCY: '0' })).toThrow(
			/LLM_CONCURRENCY/
		)
		expect(loadConfig({ ...base, LLM_CONCURRENCY: '8' }).llmConcurrency).toBe(8)
	})
})

describe('mapWithConcurrency', () => {
	test('preserves order', async () => {
		const results = await mapWithConcurrency([3, 1, 2], 2, async (n) => {
			await Bun.sleep(n * 10)
			return n * 2
		})
		expect(results).toEqual([6, 2, 4])
	})

	test('never exceeds the concurrency limit', async () => {
		let inFlight = 0
		let peak = 0
		await mapWithConcurrency(
			Array.from({ length: 12 }, (_, i) => i),
			3,
			async () => {
				inFlight++
				peak = Math.max(peak, inFlight)
				await Bun.sleep(5)
				inFlight--
			}
		)
		expect(peak).toBeLessThanOrEqual(3)
		expect(peak).toBeGreaterThan(1)
	})

	test('propagates the first failure and stops scheduling new work', async () => {
		let started = 0
		await expect(
			mapWithConcurrency(
				Array.from({ length: 20 }, (_, i) => i),
				2,
				async (n) => {
					started++
					await Bun.sleep(5)
					if (n === 1) throw new Error('boom')
				}
			)
		).rejects.toThrow('boom')
		expect(started).toBeLessThan(20)
	})
})
