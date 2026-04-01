import { PetrolBabyObject } from './mcp'
import { createGlobalDurableObjectMcpRouter } from './mcp-routing'

const mcpRouter = createGlobalDurableObjectMcpRouter({
	basePath: '/mcp',
	binding: 'PETROL_BABY_OBJECT'
})

export default {
	async fetch(
		request: Request,
		env: Env,
		_ctx: ExecutionContext
	): Promise<Response> {
		const url = new URL(request.url)

		if (request.method === 'GET' && url.pathname === '/healthz') {
			return Response.json({
				ok: true,
				service: 'petrol-baby',
				mcp_path: '/mcp'
			})
		}

		if (mcpRouter.matches(url.pathname)) {
			return mcpRouter.fetch(request, env)
		}

		return new Response('Not found', { status: 404 })
	}
} satisfies ExportedHandler<Env>

export { PetrolBabyObject }
