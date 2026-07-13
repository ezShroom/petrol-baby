import { ms } from 'ms'
import { version } from '../package.json'
import type { ServerConfig } from './config'

export const baseUrl = (config: Pick<ServerConfig, 'fuelFinderBaseUrl'>) =>
	config.fuelFinderBaseUrl

export const REPORTING_URL =
	'https://www.gov.uk/guidance/report-an-error-in-fuel-prices-or-forecourt-details'

export const USER_AGENT = `petrol-baby/${version}`
export const PERSISTENT_ACCESS_TOKEN_REFRESH_WINDOW_MS = ms('5m')

/**
 * Batch sizing for multi-row statements. SQLite's compiled-in default limit
 * is 32,766 bound parameters per statement (SQLITE_MAX_VARIABLE_NUMBER since
 * 3.32); we stay far below it so statements remain small and the write lock
 * is held only briefly per batch.
 */
export const MAX_SQLITE_VARS_PER_STATEMENT = 500
