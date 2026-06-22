import { WorkerEntrypoint } from 'cloudflare:workers'
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

/**
 * The single Durable Object instance that owns all data. MCP sessions and the
 * scheduled maintenance run both address it via this transport-prefixed name,
 * so the web RPC methods below must use the same stub to read the same data.
 */
function getDataStub(namespace: Env['PETROL_BABY_OBJECT']) {
	const fixedId = getGlobalObjectId(namespace)
	return namespace.getByName(`${MCP_TRANSPORT_PREFIX}${fixedId.toString()}`)
}

/**
 * Dispose the disposer that the RPC layer attaches to any object returned from
 * a Durable Object call, so we don't leak stubs / log "RPC stub was not
 * disposed properly". Safe on plain values.
 */
function disposeRpc(value: unknown): void {
	if (value && typeof value === 'object') {
		const fn = (value as { [Symbol.dispose]?: unknown })[Symbol.dispose]
		if (typeof fn === 'function') (fn as () => void).call(value)
	}
}

export class PetrolBabyWorker extends WorkerEntrypoint<Env> {
	override async fetch(request: Request): Promise<Response> {
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
				...this.env,
				PETROL_BABY_OBJECT: getWrappedNamespace(this.env.PETROL_BABY_OBJECT)
			}
			return PetrolBabyObject.serve(MCP_BASE_PATH, {
				binding: 'PETROL_BABY_OBJECT'
			}).fetch(request, wrappedEnv, this.ctx)
		}

		// Live price websocket — forwarded straight to the data DO, which
		// handles the upgrade itself (see PetrolBabyObject.fetch).
		if (url.pathname === '/live') {
			return getDataStub(this.env.PETROL_BABY_OBJECT).fetch(request)
		}

		return new Response('Not found', { status: 404 })
	}

	override async scheduled(_controller: ScheduledController): Promise<void> {
		const stub = getDataStub(this.env.PETROL_BABY_OBJECT)
		await stub
			.runScheduledMaintenance()
			.catch((error) => console.error('scheduled maintenance failed:', error))
	}

	// ─── RPC methods consumed by the web worker over the service binding ─────
	//
	// These return JSON strings rather than objects. The web side then receives
	// a primitive (no RPC disposer attached, nothing to leak), and we dispose
	// the Durable Object result here so neither hop logs "RPC stub was not
	// disposed properly".

	async getStationPage(slug: string): Promise<string> {
		const result = await getDataStub(
			this.env.PETROL_BABY_OBJECT
		).getStationPage(slug)
		try {
			return JSON.stringify(result)
		} finally {
			disposeRpc(result)
		}
	}

	async getStationCompare(nodeId: string, fuelType: string): Promise<string> {
		const result = await getDataStub(
			this.env.PETROL_BABY_OBJECT
		).getStationCompare(nodeId, fuelType)
		try {
			return JSON.stringify(result ?? null)
		} finally {
			disposeRpc(result)
		}
	}

	async listStations(options: {
		cursor: string | null
		query: string | null
		limit?: number
	}): Promise<string> {
		const result = await getDataStub(
			this.env.PETROL_BABY_OBJECT
		).listStationsPage(options)
		try {
			return JSON.stringify(result)
		} finally {
			disposeRpc(result)
		}
	}

	async listSitemapSlugs(cursor: string | null): Promise<string> {
		const result = await getDataStub(
			this.env.PETROL_BABY_OBJECT
		).listSitemapSlugs(cursor)
		try {
			return JSON.stringify(result)
		} finally {
			disposeRpc(result)
		}
	}
}

export default PetrolBabyWorker
export { PetrolBabyObject }
