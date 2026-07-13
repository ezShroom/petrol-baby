import { getSharedService, type PetrolBabyService } from '@petrol-baby/server'
import { building } from '$app/environment'

let service: PetrolBabyService | null = null
let shutdownHooked = false

/**
 * The process-wide data service. Initialised once from `hooks.server.ts`
 * `init` (which runs before the first request); throws if something asks for
 * data before that, or during prerendering, where no database exists.
 */
export function getService(): PetrolBabyService {
	if (!service) {
		throw new Error(
			'PetrolBabyService is not initialised. It is created in the server init hook and is unavailable during prerendering/build.'
		)
	}
	return service
}

/**
 * Open the database (running migrations) and start the maintenance
 * scheduler. Called from the server `init` hook. Migrations complete before
 * the first request is served; maintenance itself runs in the background and
 * never blocks startup.
 */
export function startService(): void {
	if (building || service) return

	service = getSharedService()
	service.startScheduler()

	if (!shutdownHooked) {
		shutdownHooked = true
		// Emitted by adapter-node after the HTTP server has closed all
		// connections; also fired for SIGINT/SIGTERM during `vite dev`.
		process.on('sveltekit:shutdown', () => {
			void service?.close().catch((error) => {
				console.error('Error during service shutdown:', error)
			})
		})
	}
}
