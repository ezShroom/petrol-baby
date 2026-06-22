/**
 * Public type surface consumed by the web package over the service binding.
 *
 * IMPORTANT: this module must only re-export *types* that are free of worker
 * runtime concerns (no `@/` path aliases, `*.md`/`*.sql` ambient modules, or
 * `cloudflare:workers` imports), so the web package can type the RPC binding
 * without compiling the entire worker source graph.
 */

export type {
	ComparisonPrice,
	ComparisonStation,
	CompareData,
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

/**
 * The RPC methods exposed by the backend WorkerEntrypoint (see src/index.ts).
 *
 * They return JSON strings (not objects) on purpose: a primitive return has no
 * RPC disposer attached on the receiving side, so the web worker never has to
 * dispose anything. Use the typed helpers in the web package to parse them
 * back into the shapes above.
 */
export interface PetrolBabyBackend {
	getStationPage(slug: string): Promise<string>
	getStationCompare(nodeId: string, fuelType: string): Promise<string>
	listStations(options: {
		cursor: string | null
		query: string | null
		limit?: number
	}): Promise<string>
	listSitemapSlugs(cursor: string | null): Promise<string>
}
