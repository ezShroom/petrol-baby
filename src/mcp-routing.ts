import type { PetrolBabyObject } from './mcp'

const DEFAULT_GLOBAL_OBJECT_NAME = 'global'

type PetrolBabyBinding = 'PETROL_BABY_OBJECT'
type PetrolBabyNamespace = DurableObjectNamespace<PetrolBabyObject>
type PetrolBabyStub = DurableObjectStub<PetrolBabyObject>

type DurableObjectTarget =
	| { type: 'name'; value: string }
	| { type: 'id'; value: DurableObjectId }

type DurableObjectTargetResolver = (
	request: Request,
	env: Env
) => DurableObjectTarget

interface DurableObjectMcpRouterOptions {
	basePath: string
	binding: PetrolBabyBinding
	resolveTarget?: DurableObjectTargetResolver
}

interface GlobalDurableObjectMcpRouterOptions {
	basePath: string
	binding: PetrolBabyBinding
	name?: string
}

function normalizeBasePath(basePath: string): string {
	if (!basePath.startsWith('/')) {
		throw new Error(`Expected basePath to start with '/': ${basePath}`)
	}

	return basePath.endsWith('/') && basePath !== '/'
		? basePath.slice(0, -1)
		: basePath
}

function matchesBasePath(pathname: string, basePath: string): boolean {
	return pathname === basePath || pathname.startsWith(`${basePath}/`)
}

function getStub(
	namespace: PetrolBabyNamespace,
	target: DurableObjectTarget
): PetrolBabyStub {
	return target.type === 'name'
		? namespace.getByName(target.value)
		: namespace.get(target.value)
}

export function createDurableObjectMcpRouter({
	basePath,
	binding,
	resolveTarget = () => ({
		type: 'name',
		value: DEFAULT_GLOBAL_OBJECT_NAME
	})
}: DurableObjectMcpRouterOptions) {
	const normalizedBasePath = normalizeBasePath(basePath)

	return {
		matches(pathname: string): boolean {
			return matchesBasePath(pathname, normalizedBasePath)
		},

		async fetch(request: Request, env: Env): Promise<Response> {
			const target = resolveTarget(request, env)
			const namespace = env[binding]
			const stub = getStub(namespace, target)

			return stub.fetch(request)
		}
	}
}

export function createGlobalDurableObjectMcpRouter({
	basePath,
	binding,
	name = DEFAULT_GLOBAL_OBJECT_NAME
}: GlobalDurableObjectMcpRouterOptions) {
	return createDurableObjectMcpRouter({
		basePath,
		binding,
		resolveTarget: () => ({
			type: 'name',
			value: name
		})
	})
}
