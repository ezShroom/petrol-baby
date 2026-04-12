import { ms } from 'ms'
import { version } from '../package.json'

type EnvWithApi = { USE_API?: string; FUEL_FINDER_EXTRA_HEADERS?: string }

function isUrl(value: string): boolean {
	return value.startsWith('http://') || value.startsWith('https://')
}

export const baseUrl = <T extends object>(env: T & EnvWithApi) => {
	const api = env.USE_API
	if (api && isUrl(api)) return api.replace(/\/+$/, '')
	if (api === 'test') return 'https://stg.fuel-finder.ics.gov.uk/api'
	return 'https://www.fuel-finder.service.gov.uk/api'
}

/**
 * Parse the optional `FUEL_FINDER_EXTRA_HEADERS` env var into a
 * `Record<string, string>`.  The value should be a JSON object, e.g.
 * `{"X-Proxy-Key": "secret"}`.  Returns an empty object when the var
 * is unset or empty.
 */
export function extraHeaders<T extends object>(
	env: T & EnvWithApi
): Record<string, string> {
	const raw = env.FUEL_FINDER_EXTRA_HEADERS
	if (!raw) return {}
	try {
		const parsed: unknown = JSON.parse(raw)
		if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
			throw new TypeError('FUEL_FINDER_EXTRA_HEADERS must be a JSON object')
		return parsed as Record<string, string>
	} catch (error) {
		console.error('Failed to parse FUEL_FINDER_EXTRA_HEADERS:', error)
		return {}
	}
}

export const REPORTING_URL =
	'https://www.gov.uk/guidance/report-an-error-in-fuel-prices-or-forecourt-details'

export const USER_AGENT = `petrol-baby/${version}`
export const PERSISTENT_ACCESS_TOKEN_REFRESH_WINDOW_MS = ms('5m')

// https://developers.cloudflare.com/durable-objects/platform/limits/#sql-storage-limits
export const MAX_SQLITE_VARS_PER_STATEMENT = 100
