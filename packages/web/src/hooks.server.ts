import type { Handle } from '@sveltejs/kit'

export const handle: Handle = async ({ event, resolve }) => {
	if (event.url.pathname === '/mcp') {
		const backend = event.platform?.env?.MCP_BACKEND
		if (!backend) {
			return new Response('MCP backend unavailable', { status: 503 })
		}
		try {
			const res = await backend.fetch(event.request.url, event.request)
			return new Response(res.body, {
				status: res.status,
				statusText: res.statusText,
				headers: res.headers
			})
		} catch (e) {
			// Client disconnected (e.g. SSE reconnect, tab closed) — the abort
			// signal from SvelteKit's node adapter fires and rejects the fetch.
			// Nothing to send back since the client is already gone.
			if (e instanceof DOMException && e.name === 'AbortError') {
				return new Response(null, { status: 499 })
			}
			throw e
		}
	}

	return resolve(event)
}
