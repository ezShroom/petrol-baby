import { PetrolBabyObject } from './mcp'

const mcpHandler = PetrolBabyObject.serve('/mcp', {
	binding: 'PETROL_BABY_OBJECT'
})

export default {
	async fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext
	): Promise<Response> {
		const url = new URL(request.url)

		if (request.method === 'GET' && url.pathname === '/healthz') {
			return Response.json({
				ok: true,
				service: 'petrol-baby',
				mcp_path: '/mcp'
			})
		}

		return mcpHandler.fetch(request, env, ctx)
	}
} satisfies ExportedHandler<Env>

export { PetrolBabyObject }
