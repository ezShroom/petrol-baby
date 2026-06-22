// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { PetrolBabyBackend } from '@petrol-baby/worker'

declare global {
	namespace App {
		interface Platform {
			env: {
				MCP_BACKEND: Fetcher & PetrolBabyBackend
				ASSETS: Fetcher
			}
			ctx: ExecutionContext
			caches: CacheStorage
			cf?: IncomingRequestCfProperties
		}

		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
	}
}

export {}
