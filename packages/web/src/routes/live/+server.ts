import { error } from '@sveltejs/kit'
import type { RequestHandler } from '@sveltejs/kit'
import { getService } from '$lib/server/service'

/**
 * Live price updates for one station as Server-Sent Events. The old
 * deployment used WebSockets because Durable Objects made them cheap; the
 * channel is strictly server-to-client, so SSE does the same job through
 * plain HTTP (which SvelteKit, Bun, and the Cloudflare Tunnel all stream
 * natively) and EventSource gives the browser reconnection for free.
 */
export const GET: RequestHandler = ({ url, request }) => {
	const nodeId = url.searchParams.get('station')
	if (!nodeId) {
		throw error(400, 'Missing station parameter')
	}

	const stream = getService().live.subscribe(nodeId, request.signal)

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-store, no-transform',
			Connection: 'keep-alive',
			// Belt and braces for any buffering intermediary.
			'X-Accel-Buffering': 'no'
		}
	})
}
