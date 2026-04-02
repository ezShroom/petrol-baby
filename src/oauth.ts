import type { DrizzleSqliteDODatabase } from 'drizzle-orm/durable-sqlite'
import { key } from './db/schema'
import { KeyType } from './types/KeyType'
import { baseUrl, USER_AGENT } from './constants'
import { parseJsonResponse } from './response'

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

		if (!this.accessTokenRefreshPromise) {
			this.accessTokenRefreshPromise = Promise.resolve()
				.then(() => {
					if (!this.accessTokenExpiresWithin(refreshWindowMs)) return
					return this.refreshAccessToken()
				})
				.finally(() => {
					this.accessTokenRefreshPromise = undefined
				})
		}

		await this.accessTokenRefreshPromise
	}

	private accessTokenExpiresWithin(refreshWindowMs: number): boolean {
		if (!this.accessToken) return true

		return this.accessToken.expires.getTime() - Date.now() <= refreshWindowMs
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

	private getTokenPayload(
		results: FuelFinderOAuthResponse
	): FuelFinderTokenPayload {
		return results.data ?? results
	}

	private async generateAccessAndRefreshTokens(): Promise<void> {
		const response = await fetch(
			baseUrl(this.env) + '/v1/oauth/generate_access_token',
			{
				method: 'POST',
				headers: {
					Accept: 'application/json',
					'Content-Type': 'application/json',
					'User-Agent': USER_AGENT
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

		await this.db.insert(key).values([
			{ type: KeyType.Refresh, key: this.refreshToken },
			{
				type: KeyType.Access,
				key: this.accessToken.value,
				expires: this.accessToken.expires
			}
		])
	}

	private async refreshAccessToken(): Promise<void> {
		if (!this.refreshToken) {
			await this.generateAccessAndRefreshTokens()
			return
		}

		const response = await fetch(
			baseUrl(this.env) + '/v1/oauth/regenerate_access_token',
			{
				method: 'POST',
				headers: {
					Accept: 'application/json',
					'Content-Type': 'application/json',
					'User-Agent': USER_AGENT
				},
				body: JSON.stringify({
					client_id: this.env.FUEL_FINDER_CLIENT_ID,
					refresh_token: this.refreshToken
				})
			}
		)
		const regenerateResults = await parseJsonResponse<FuelFinderOAuthResponse>(
			response,
			{
				context: 'Fuel Finder OAuth regenerate_access_token'
			}
		)
		const regeneratePayload = this.getTokenPayload(regenerateResults)

		if (!response.ok) {
			throw new Error(
				regenerateResults.error ??
					regenerateResults.message ??
					`Failed to regenerate Fuel Finder access token (${response.status})`
			)
		}

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
