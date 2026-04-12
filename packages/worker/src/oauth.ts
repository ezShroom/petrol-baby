import type { DrizzleSqliteDODatabase } from 'drizzle-orm/durable-sqlite'
import { StatusCodes } from 'http-status-codes'
import { baseUrl, extraHeaders, USER_AGENT } from './constants'
import { key } from './db/schema'
import { patientFetch } from './patient_fetch'
import { parseJsonResponse } from './response'
import { KeyType } from './types/KeyType'

type FuelFinderTokenPayload = {
	access_token?: string
	refresh_token?: string
	expires_in?: number
}

type FuelFinderOAuthResponse = {
	error?: string
	success?: boolean
	message?: string
	data?: FuelFinderTokenPayload
} & FuelFinderTokenPayload

export class FuelFinderOAuth {
	public refreshToken?: string
	public accessToken?: {
		value: string
		expires: Date
	}
	private accessTokenRefreshPromise?: Promise<void>

	constructor(
		private readonly db: DrizzleSqliteDODatabase<Record<string, unknown>>,
		private readonly env: Env
	) {}

	async initialize(): Promise<void> {
		const retrievedKeys = await this.db.select().from(key)
		const refreshKey = retrievedKeys.find(
			(retrievedKey) => retrievedKey.type === KeyType.Refresh
		)
		const accessKey = retrievedKeys.find(
			(retrievedKey) => retrievedKey.type === KeyType.Access
		)

		this.refreshToken = refreshKey?.key
		this.accessToken = accessKey?.expires
			? {
					value: accessKey.key,
					expires: accessKey.expires
				}
			: undefined

		if (!this.refreshToken) {
			await this.generateAccessAndRefreshTokens()
		}
	}

	async ensureAccessToken(refreshWindowMs: number): Promise<void> {
		if (!this.refreshToken) {
			await this.generateAccessAndRefreshTokens()
			return
		}

		if (!this.accessTokenExpiresWithin(refreshWindowMs)) {
			return
		}

		await this.runAccessTokenRefresh({ refreshWindowMs })
	}

	async forceRefreshAccessToken(): Promise<void> {
		await this.runAccessTokenRefresh({ force: true })
	}

	private accessTokenExpiresWithin(refreshWindowMs: number): boolean {
		if (!this.accessToken) return true

		return this.accessToken.expires.getTime() - Date.now() <= refreshWindowMs
	}

	private async runAccessTokenRefresh({
		force = false,
		refreshWindowMs = 0
	}: {
		force?: boolean
		refreshWindowMs?: number
	}): Promise<void> {
		if (!this.accessTokenRefreshPromise) {
			this.accessTokenRefreshPromise = Promise.resolve()
				.then(() => {
					if (!force && !this.accessTokenExpiresWithin(refreshWindowMs)) return
					return this.refreshAccessToken()
				})
				.finally(() => {
					this.accessTokenRefreshPromise = undefined
				})
		}

		await this.accessTokenRefreshPromise
	}

	private async persistAccessToken(accessToken: {
		value: string
		expires: Date
	}): Promise<void> {
		await this.db
			.insert(key)
			.values({
				type: KeyType.Access,
				key: accessToken.value,
				expires: accessToken.expires
			})
			.onConflictDoUpdate({
				target: key.type,
				set: {
					key: accessToken.value,
					expires: accessToken.expires
				}
			})
	}

	private async persistRefreshToken(refreshToken: string): Promise<void> {
		await this.db
			.insert(key)
			.values({
				type: KeyType.Refresh,
				key: refreshToken
			})
			.onConflictDoUpdate({
				target: key.type,
				set: {
					key: refreshToken
				}
			})
	}

	private getTokenPayload(
		results: FuelFinderOAuthResponse
	): FuelFinderTokenPayload {
		return results.data ?? results
	}

	private async generateAccessAndRefreshTokens(): Promise<void> {
		const response = await patientFetch(
			baseUrl(this.env) + '/v1/oauth/generate_access_token',
			{
				method: 'POST',
				headers: {
					Accept: 'application/json',
					'Content-Type': 'application/json',
					'User-Agent': USER_AGENT,
					...extraHeaders(this.env)
				},
				body: JSON.stringify({
					client_id: this.env.FUEL_FINDER_CLIENT_ID,
					client_secret: this.env.FUEL_FINDER_CLIENT_SECRET
				})
			}
		)
		const generateResults = await parseJsonResponse<FuelFinderOAuthResponse>(
			response,
			{
				context: 'Fuel Finder OAuth generate_access_token'
			}
		)
		const generatePayload = this.getTokenPayload(generateResults)

		if (!response.ok || generateResults.success === false || !generatePayload) {
			throw new Error(
				generateResults.error ??
					generateResults.message ??
					`Failed to generate Fuel Finder OAuth tokens (${response.status})`
			)
		}

		if (
			typeof generatePayload.access_token !== 'string' ||
			typeof generatePayload.refresh_token !== 'string' ||
			typeof generatePayload.expires_in !== 'number'
		) {
			throw new Error('Fuel Finder generate_access_token returned invalid data')
		}

		this.refreshToken = generatePayload.refresh_token
		this.accessToken = {
			value: generatePayload.access_token,
			expires: new Date(Date.now() + generatePayload.expires_in * 1000)
		}

		await Promise.all([
			this.persistRefreshToken(this.refreshToken),
			this.persistAccessToken(this.accessToken)
		])
	}

	private async refreshAccessToken(): Promise<void> {
		if (!this.refreshToken) {
			await this.generateAccessAndRefreshTokens()
			return
		}

		const response = await patientFetch(
			baseUrl(this.env) + '/v1/oauth/regenerate_access_token',
			{
				method: 'POST',
				headers: {
					Accept: 'application/json',
					'Content-Type': 'application/json',
					'User-Agent': USER_AGENT,
					...extraHeaders(this.env)
				},
				body: JSON.stringify({
					client_id: this.env.FUEL_FINDER_CLIENT_ID,
					refresh_token: this.refreshToken
				})
			}
		)

		// Check error statuses before attempting to parse JSON, since maintenance
		// pages can return HTML and revoked refresh tokens should fall back to a
		// full token generation flow.
		if (!response.ok) {
			if (
				response.status === StatusCodes.INTERNAL_SERVER_ERROR ||
				response.status === StatusCodes.UNAUTHORIZED ||
				response.status === StatusCodes.FORBIDDEN
			) {
				console.warn(
					`regenerate_access_token returned ${response.status}, falling back to generate_access_token`
				)
				await this.generateAccessAndRefreshTokens()
				return
			}
			// For other error statuses, try to parse JSON for a useful error message
			let errorMessage = `Failed to regenerate Fuel Finder access token (${response.status})`
			try {
				const errorResults = await parseJsonResponse<FuelFinderOAuthResponse>(
					response,
					{
						context: 'Fuel Finder OAuth regenerate_access_token'
					}
				)
				errorMessage =
					errorResults.error ?? errorResults.message ?? errorMessage
			} catch {
				// JSON parsing failed, use the default error message
			}
			throw new Error(errorMessage)
		}

		const regenerateResults = await parseJsonResponse<FuelFinderOAuthResponse>(
			response,
			{
				context: 'Fuel Finder OAuth regenerate_access_token'
			}
		)
		const regeneratePayload = this.getTokenPayload(regenerateResults)

		if (
			typeof regeneratePayload.access_token !== 'string' ||
			typeof regeneratePayload.expires_in !== 'number'
		) {
			throw new Error(
				`Fuel Finder regenerate_access_token returned invalid data: ${JSON.stringify(regenerateResults)}`
			)
		}

		this.accessToken = {
			value: regeneratePayload.access_token,
			expires: new Date(Date.now() + regeneratePayload.expires_in * 1000)
		}

		await this.persistAccessToken(this.accessToken)
	}
}
