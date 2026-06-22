import { error } from '@sveltejs/kit'
import { getBackend } from '$lib/server/backend'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async ({ url, platform, setHeaders }) => {
	const nodeId = url.searchParams.get('nodeId')
	const fuel = url.searchParams.get('fuel')
	if (!nodeId || !fuel) {
		throw error(400, 'Missing nodeId or fuel parameter.')
	}

	const backend = getBackend(platform)
	// The backend already returns a JSON string; pass it straight through.
	const body = await backend.getStationCompare(nodeId, fuel)
	if (body === 'null') {
		throw error(404, 'Station not found.')
	}

	setHeaders({
		'cache-control':
			'public, max-age=60, s-maxage=120, stale-while-revalidate=600'
	})
	return new Response(body, {
		headers: { 'content-type': 'application/json' }
	})
}
