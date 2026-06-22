import { proxyToBackend } from '$lib/server/backend'
import type { RequestHandler } from './$types'

/**
 * Live price websocket. The actual upgrade is handled by the backend worker's
 * Durable Object; we just forward the request (preserving the `webSocket`
 * handle on the 101 response).
 *
 * In dev this endpoint is invoked directly by vite-plugin-sveltekit-cf-websockets
 * (which bridges the Node socket to the Cloudflare websocket); in production
 * SvelteKit routes the upgrade here.
 */
export const GET: RequestHandler = ({ request, platform }) => {
	return proxyToBackend(platform, request)
}
