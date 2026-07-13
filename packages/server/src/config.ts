/**
 * Runtime configuration for the petrol.baby server.
 *
 * This replaces the Cloudflare Workers `Env` binding object. Everything is
 * sourced from process environment variables exactly once at startup and
 * validated eagerly so a misconfigured deployment fails loudly instead of
 * failing on the first API call hours later.
 */

export type ServerConfig = {
	/** Absolute path to the SQLite database file. */
	databasePath: string
	fuelFinderClientId: string
	fuelFinderClientSecret: string
	/** Fuel Finder API base URL, without a trailing slash. */
	fuelFinderBaseUrl: string
	/**
	 * OpenRouter API key. Optional at load time: read-only operation works
	 * without it, but station cleaning (backfill / changed stations) and
	 * amenity naming require it.
	 */
	openRouterApiKey: string | undefined
	/** Maximum concurrent station-cleaning LLM batches. */
	llmConcurrency: number
}

export const PRODUCTION_FUEL_FINDER_BASE_URL =
	'https://www.fuel-finder.service.gov.uk/api'

// Unbounded by default: fire every batch at once. OpenRouter scales limits
// with your credit balance, so throttling here is an antipattern. Set
// LLM_CONCURRENCY to an integer only if you deliberately want a cap.
const DEFAULT_LLM_CONCURRENCY = Number.POSITIVE_INFINITY

function required(
	env: Record<string, string | undefined>,
	key: string
): string {
	const value = env[key]?.trim()
	if (!value) {
		throw new Error(
			`Missing required environment variable ${key}. ` +
				`See packages/server/.env.example for the full list.`
		)
	}
	return value
}

/**
 * Load and validate configuration from the process environment (or any
 * provided record, which keeps tests hermetic).
 */
export function loadConfig(
	env: Record<string, string | undefined> = process.env
): ServerConfig {
	const databasePath = required(env, 'DATABASE_PATH')
	if (!databasePath.startsWith('/') && databasePath !== ':memory:') {
		throw new Error(
			`DATABASE_PATH must be an absolute path (got "${databasePath}"). ` +
				`Relative paths silently create a new database when the working ` +
				`directory changes.`
		)
	}

	const baseUrlRaw = env['FUEL_FINDER_BASE_URL']?.trim()
	const fuelFinderBaseUrl = (
		baseUrlRaw && baseUrlRaw.length > 0
			? baseUrlRaw
			: PRODUCTION_FUEL_FINDER_BASE_URL
	).replace(/\/+$/, '')

	const llmConcurrencyRaw = env['LLM_CONCURRENCY']?.trim()
	const llmConcurrency = llmConcurrencyRaw
		? Number.parseInt(llmConcurrencyRaw, 10)
		: DEFAULT_LLM_CONCURRENCY
	if (
		llmConcurrencyRaw &&
		(!Number.isInteger(llmConcurrency) || llmConcurrency < 1)
	) {
		throw new Error(
			`LLM_CONCURRENCY must be a positive integer (got "${llmConcurrencyRaw}")`
		)
	}

	return {
		databasePath,
		fuelFinderClientId: required(env, 'FUEL_FINDER_CLIENT_ID'),
		fuelFinderClientSecret: required(env, 'FUEL_FINDER_CLIENT_SECRET'),
		fuelFinderBaseUrl,
		openRouterApiKey: env['OPENROUTER_API_KEY']?.trim() || undefined,
		llmConcurrency
	}
}
