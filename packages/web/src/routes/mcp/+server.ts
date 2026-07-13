import { handleMcpRequest } from '@petrol-baby/server'
import type { RequestHandler } from '@sveltejs/kit'
import { getService } from '$lib/server/service'

// Model Context Protocol endpoint (Streamable HTTP, stateless JSON mode).
// Each POST gets a fresh MCP server + transport pair against the shared data
// service, so concurrent clients cannot interfere with each other.

const ALLOWED_LOCAL_ORIGINS = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/

/**
 * Browser-origin check (DNS-rebinding defence). Non-browser MCP clients
 * don't send Origin and pass straight through; browsers must come from our
 * own origin or localhost.
 */
function isOriginAllowed(request: Request, requestOrigin: string): boolean {
	const origin = request.headers.get('origin')
	if (!origin) return true
	return origin === requestOrigin || ALLOWED_LOCAL_ORIGINS.test(origin)
}

const rejected = (status: number, message: string) =>
	new Response(
		JSON.stringify({
			jsonrpc: '2.0',
			error: { code: -32000, message },
			id: null
		}),
		{ status, headers: { 'Content-Type': 'application/json' } }
	)

export const POST: RequestHandler = async ({ request, url }) => {
	if (!isOriginAllowed(request, url.origin)) {
		return rejected(403, 'Forbidden: invalid Origin header')
	}
	return handleMcpRequest(getService(), request)
}

// Without sessions there are no server-initiated streams to GET and no
// session to DELETE; both are explicit 405s per the stateless pattern.
export const GET: RequestHandler = () => {
	const response = rejected(405, 'Method not allowed.')
	response.headers.set('Allow', 'POST')
	return response
}

export const DELETE: RequestHandler = GET
export const PUT: RequestHandler = GET
export const PATCH: RequestHandler = GET
