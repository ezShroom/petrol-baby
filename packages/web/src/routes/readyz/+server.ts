import { json } from '@sveltejs/kit'
import type { RequestHandler } from '@sveltejs/kit'
import { getService } from '$lib/server/service'

/**
 * Readiness: both data regions have completed their initial backfill, so
 * station pages and MCP queries return real data. Stays 503 on a fresh
 * database until `bun run data:backfill` has been run.
 */
export const GET: RequestHandler = async () => {
	try {
		const ready = await getService().isReady()
		return json({ ready }, { status: ready ? 200 : 503 })
	} catch (error) {
		console.error('readyz failed:', error)
		return json({ ready: false }, { status: 503 })
	}
}
