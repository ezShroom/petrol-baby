import { PetrolBabyObject } from './mcp'

const MCP_BASE_PATH = '/mcp'
const MCP_GLOBAL_INSTANCE_NAME = 'global'
const MCP_TRANSPORT_PREFIX = 'streamable-http:'

function getGlobalObjectId(namespace: Env['PETROL_BABY_OBJECT']) {
	return namespace.idFromName(MCP_GLOBAL_INSTANCE_NAME)
}

function getWrappedNamespace(namespace: Env['PETROL_BABY_OBJECT']) {
	const fixedId = getGlobalObjectId(namespace)
	return new Proxy(namespace, {
		get(target, prop) {
			if (prop === 'newUniqueId') {
				return () => fixedId
			}
			const value = Reflect.get(target, prop)
			if (typeof value === 'function') {
				return value.bind(target)
			}
			return value
		}
	})
}

function getScheduledMaintenanceStub(namespace: Env['PETROL_BABY_OBJECT']) {
	const fixedId = getGlobalObjectId(namespace)
	return namespace.getByName(`${MCP_TRANSPORT_PREFIX}${fixedId.toString()}`)
}

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
			const wrappedEnv = {
				...env,
				PETROL_BABY_OBJECT: getWrappedNamespace(env.PETROL_BABY_OBJECT)
			}
			return PetrolBabyObject.serve(MCP_BASE_PATH, {
				binding: 'PETROL_BABY_OBJECT'
			}).fetch(request, wrappedEnv, ctx)
		}

		return new Response('Not found', { status: 404 })
	},

	async scheduled(
		_controller: ScheduledController,
		env: Env,
		ctx: ExecutionContext
	): Promise<void> {
		const stub = getScheduledMaintenanceStub(env.PETROL_BABY_OBJECT)
		ctx.waitUntil(
			stub
				.runScheduledMaintenance()
				.catch((error) => console.error('scheduled maintenance failed:', error))
		)
	}
} satisfies ExportedHandler<Env>

export { PetrolBabyObject }
