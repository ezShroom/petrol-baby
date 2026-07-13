import { fetchStations } from '$lib/server/backend'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ url, setHeaders }) => {
	const cursor = url.searchParams.get('cursor')
	const query = url.searchParams.get('q')

	const result = await fetchStations({ cursor, query })

	setHeaders({
		'cache-control':
			'public, max-age=300, s-maxage=600, stale-while-revalidate=3600'
	})

	return {
		items: result.items,
		nextCursor: result.nextCursor,
		query: query ?? '',
		isFiltered: Boolean(cursor || query)
	}
}
