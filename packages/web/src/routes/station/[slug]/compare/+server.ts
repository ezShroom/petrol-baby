import { error, json } from '@sveltejs/kit'
import { fetchStationCompare } from '$lib/server/backend'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async ({ url, setHeaders }) => {
	const nodeId = url.searchParams.get('nodeId')
	const fuel = url.searchParams.get('fuel')
	if (!nodeId || !fuel) {
		throw error(400, 'Missing nodeId or fuel parameter.')
	}

	const result = await fetchStationCompare(nodeId, fuel)
	if (result === null) {
		throw error(404, 'Station not found.')
	}

	setHeaders({
		'cache-control':
			'public, max-age=60, s-maxage=120, stale-while-revalidate=600'
	})
	return json(result)
}
