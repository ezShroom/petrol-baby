import { ms } from 'ms'
import { version } from '../package.json'

export const baseUrl = <T extends object>(env: T & { USE_API?: string }) =>
	env.USE_API === 'test'
		? 'https://stg.fuel-finder.ics.gov.uk/api'
		: 'https://www.fuel-finder.service.gov.uk/api'
export const USER_AGENT = `petrol-baby/${version}`
export const PERSISTENT_ACCESS_TOKEN_REFRESH_WINDOW_MS = ms('5m')
export const REPORTING_URL =
	'https://www.gov.uk/guidance/report-an-error-in-fuel-prices-or-forecourt-details'
