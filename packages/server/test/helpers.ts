import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ServerConfig } from '../src/config'

/** A throwaway on-disk database path (WAL needs a real file). */
export function tempDatabasePath(): { path: string; cleanup: () => void } {
	const dir = mkdtempSync(join(tmpdir(), 'petrol-baby-test-'))
	return {
		path: join(dir, 'test.sqlite'),
		cleanup: () => rmSync(dir, { recursive: true, force: true })
	}
}

export function testConfig(databasePath: string): ServerConfig {
	return {
		databasePath,
		fuelFinderClientId: 'test-client-id',
		fuelFinderClientSecret: 'test-client-secret',
		fuelFinderBaseUrl: 'http://127.0.0.1:1/unreachable',
		openRouterApiKey: undefined,
		llmConcurrency: 2
	}
}
