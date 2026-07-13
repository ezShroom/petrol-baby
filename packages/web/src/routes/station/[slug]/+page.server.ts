import { error, redirect } from '@sveltejs/kit'
import { fetchStationPage } from '$lib/server/backend'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ params, setHeaders }) => {
	const result = await fetchStationPage(params.slug)

	if (result.status === 'not_found') {
		throw error(404, 'We don’t have a station at that address.')
	}
	if (result.status === 'redirect') {
		throw redirect(301, `/station/${result.canonicalSlug}`)
	}

	// Prices refresh roughly every minute; let the edge serve a slightly stale
	// copy while revalidating so pages stay fast and fresh for crawlers.
	setHeaders({
		'cache-control':
			'public, max-age=60, s-maxage=120, stale-while-revalidate=600'
	})

	return { payload: result.payload }
}
