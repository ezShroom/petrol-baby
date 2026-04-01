import { PetrolBabyObject } from './mcp'

const MCP_BASE_PATH = '/mcp'
const MCP_GLOBAL_INSTANCE_NAME = 'global'

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
				mcp_path: MCP_BASE_PATH
			})
		}

		if (url.pathname === MCP_BASE_PATH) {
			// wrap the namespace to ensure newUniqueId() always returns our fixed ID
			// this ensures all requests use the same durable object
			const originalNamespace = env.PETROL_BABY_OBJECT
			const fixedId = originalNamespace.idFromName(MCP_GLOBAL_INSTANCE_NAME)
			const wrappedNamespace = new Proxy(originalNamespace, {
				get(target, prop) {
					if (prop === 'newUniqueId') {
						return () => fixedId
					}
					const value = Reflect.get(target, prop)
					// bind methods to preserve 'this' context
					if (typeof value === 'function') {
						return value.bind(target)
					}
					return value
				}
			})
			const wrappedEnv = { ...env, PETROL_BABY_OBJECT: wrappedNamespace }
			return PetrolBabyObject.serve(MCP_BASE_PATH, {
				binding: 'PETROL_BABY_OBJECT'
			}).fetch(request, wrappedEnv, ctx)
		}

		return new Response('Not found', { status: 404 })
	}
} satisfies ExportedHandler<Env>

export { PetrolBabyObject }
