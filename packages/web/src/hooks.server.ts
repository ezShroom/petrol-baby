import type { ServerInit } from '@sveltejs/kit'
import { startService } from '$lib/server/service'

/**
 * Runs once before the server answers its first request: opens the SQLite
 * database (applying migrations) and starts the maintenance scheduler. No-op
 * during prerendering/build.
 */
export const init: ServerInit = () => {
	startService()
}
