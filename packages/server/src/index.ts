import { loadConfig } from './config'
import { PetrolBabyService } from './service'

/**
 * Public surface of the petrol.baby backend, consumed by the SvelteKit app
 * and the operational CLIs. Always runs as TypeScript source under Bun — it
 * is externalized from the web bundle, never compiled separately.
 */

export { loadConfig, type ServerConfig } from './config'
export { openDatabase, verifyDatabase, type AppDatabase } from './db/client'
export { LiveHub } from './live'
export { createMcpServer, handleMcpRequest } from './mcp'
export { PetrolBabyService } from './service'

export type {
	CompareData,
	ComparisonPrice,
	ComparisonStation,
	FuelPrice,
	PriceHistoryPoint,
	SitemapEntry,
	SitemapResult,
	SlugResolution,
	StationIdentity,
	StationListItem,
	StationListResult,
	StationOpeningTime,
	StationPagePayload
} from './types/StationPagePayload'

// The singleton is cached on globalThis so that dev-server module reloads
// (Vite SSR) and multiple import graphs still share one database handle and
// one scheduler — the process must only ever have a single SQLite writer.
const SERVICE_KEY = Symbol.for('petrol-baby.service')

type ServiceGlobal = { [SERVICE_KEY]?: PetrolBabyService }

/**
 * Get (or lazily create) the process-wide service. The first call opens the
 * database and runs migrations; it does NOT start the scheduler — callers
 * decide that (the web app starts it, CLIs don't).
 */
export function getSharedService(): PetrolBabyService {
	const store = globalThis as ServiceGlobal
	store[SERVICE_KEY] ??= new PetrolBabyService(loadConfig())
	return store[SERVICE_KEY]
}
