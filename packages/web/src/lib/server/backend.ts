import { error } from '@sveltejs/kit'
import type {
	CompareData,
	SitemapResult,
	SlugResolution,
	StationListResult
} from '@petrol-baby/worker'

type Backend = App.Platform['env']['MCP_BACKEND']

/**
 * Resolve the typed MCP_BACKEND service binding for server-side RPC calls.
 * Throws a 503 when the binding is unavailable (e.g. misconfigured preview).
 */
export function getBackend(platform: App.Platform | undefined): Backend {
	const backend = platform?.env?.MCP_BACKEND
	if (!backend) {
		throw error(503, 'Fuel data backend is unavailable right now.')
	}
	return backend
}

// The backend returns JSON strings (primitives), so there are no RPC stubs to
// dispose on this side. These helpers parse them back into typed shapes.

export async function fetchStationPage(
	platform: App.Platform | undefined,
	slug: string
): Promise<SlugResolution> {
	const backend = getBackend(platform)
	return JSON.parse(await backend.getStationPage(slug)) as SlugResolution
}

export async function fetchStationCompare(
	platform: App.Platform | undefined,
	nodeId: string,
	fuelType: string
): Promise<CompareData | null> {
	const backend = getBackend(platform)
	return JSON.parse(
		await backend.getStationCompare(nodeId, fuelType)
	) as CompareData | null
}

export async function fetchStations(
	platform: App.Platform | undefined,
	options: { cursor: string | null; query: string | null }
): Promise<StationListResult> {
	const backend = getBackend(platform)
	return JSON.parse(await backend.listStations(options)) as StationListResult
}

export async function fetchSitemapSlugs(
	platform: App.Platform | undefined,
	cursor: string | null
): Promise<SitemapResult> {
	const backend = getBackend(platform)
	return JSON.parse(await backend.listSitemapSlugs(cursor)) as SitemapResult
}

/**
 * Forward a WebSocket upgrade (or any request) straight to the backend worker,
 * preserving the Cloudflare `webSocket` handle on the 101 response. Used by the
 * `/live` endpoint — in dev the cf-websockets Vite plugin calls that endpoint
 * directly; in production SvelteKit routes to it.
 */
export function proxyToBackend(
	platform: App.Platform | undefined,
	request: Request
): Promise<Response> {
	const backend = platform?.env?.MCP_BACKEND
	if (!backend) {
		return Promise.resolve(
			new Response('Live backend unavailable', { status: 503 })
		)
	}
	return backend.fetch(request)
}
