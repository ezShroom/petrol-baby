import type { Handle } from '@sveltejs/kit'

export const handle: Handle = async ({ event, resolve }) => {
	if (event.url.pathname === '/mcp') {
		const backend = event.platform?.env?.MCP_BACKEND
		if (!backend) {
			return new Response('MCP backend unavailable', { status: 503 })
		}
		const res = await backend.fetch(event.request.url, event.request)
		return new Response(res.body, {
			status: res.status,
			statusText: res.statusText,
			headers: res.headers
		})
	}

	return resolve(event)
}
