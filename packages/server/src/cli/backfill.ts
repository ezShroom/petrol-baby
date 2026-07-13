/**
 * Foreground initial backfill.
 *
 *   bun run data:backfill
 *
 * Fetches the full Fuel Finder station and price datasets, cleans stations
 * through OpenRouter (bounded concurrency), and persists everything in
 * resumable chunks. Safe to re-run after an interruption: stations whose
 * `sourceHash` already matches a persisted row are not sent back through the
 * paid LLM passes, and completed regions are skipped entirely.
 *
 * Run this before starting the web service for the first time; the service
 * reports not-ready (and its scheduler stays idle) until both regions exist.
 */
import { loadConfig } from '../config'
import { PetrolBabyService } from '../service'

const config = loadConfig()

if (!config.openRouterApiKey) {
	console.error(
		'OPENROUTER_API_KEY is not set. The station backfill requires it for ' +
			'name/address cleaning (expect a bit over $10 of usage for a full run).'
	)
	process.exit(1)
}

console.log(`Database: ${config.databasePath}`)
console.log(`Fuel Finder API: ${config.fuelFinderBaseUrl}`)
console.log(
	`LLM concurrency: ${
		Number.isFinite(config.llmConcurrency) ? config.llmConcurrency : 'unbounded'
	}`
)

const service = new PetrolBabyService(config)

const startedAt = Date.now()
try {
	await service.runInitialBackfill()

	// Belt and braces before declaring success.
	service.verify()

	const seconds = Math.round((Date.now() - startedAt) / 1000)
	console.log(`Backfill complete in ${seconds}s.`)
	console.log(
		'You can now start the web service; the scheduler will keep the data fresh.'
	)
} catch (error) {
	console.error('Backfill failed:', error)
	console.error(
		'Re-running this command resumes from persisted progress — already ' +
			'cleaned stations are not re-billed.'
	)
	process.exitCode = 1
} finally {
	await service.close()
}
