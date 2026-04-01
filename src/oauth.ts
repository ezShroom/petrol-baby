import type { DrizzleSqliteDODatabase } from 'drizzle-orm/durable-sqlite'
import { keys } from './db/schema'
import { KeyType } from './types/KeyType'

const BASE_URL = 'https://www.fuel-finder.service.gov.uk/api'

export class FuelFinderOAuth {
	private refreshToken?: string
	private accessToken?: {
		value: string
		expires: Date
	}
	private accessTokenRefreshPromise?: Promise<void>

	constructor(
		private readonly db: DrizzleSqliteDODatabase<Record<string, unknown>>,
		private readonly env: Env,
		private readonly userAgent: string
	) {}

	async initialize(initialAccessTokenRefreshWindowMs: number): Promise<void> {
		const retrievedKeys = await this.db.select().from(keys)
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
			return
		}

		if (this.accessTokenExpiresWithin(initialAccessTokenRefreshWindowMs)) {
			await this.refreshAccessToken()
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
			.insert(keys)
			.values({
				type: KeyType.Access,
				key: accessToken.value,
				expires: accessToken.expires
			})
			.onConflictDoUpdate({
				target: keys.type,
				set: {
					key: accessToken.value,
					expires: accessToken.expires
				}
			})
	}

	private async generateAccessAndRefreshTokens(): Promise<void> {
		const response = await fetch(BASE_URL + '/v1/oauth/generate_access_token', {
			method: 'POST',
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
				'User-Agent': this.userAgent
			},
			body: JSON.stringify({
				client_id: this.env.FUEL_FINDER_CLIENT_ID,
				client_secret: this.env.FUEL_FINDER_CLIENT_SECRET
			})
		})
		const generateResults = (await response.json()) as {
			error?: string
			success?: boolean
			message?: string
			data?: {
				access_token?: string
				refresh_token?: string
				expires_in?: number
			}
		}

		if (!response.ok || !generateResults.success || !generateResults.data) {
			throw new Error(
				generateResults.error ??
					generateResults.message ??
					`Failed to generate Fuel Finder OAuth tokens (${response.status})`
			)
		}

		if (
			typeof generateResults.data.access_token !== 'string' ||
			typeof generateResults.data.refresh_token !== 'string' ||
			typeof generateResults.data.expires_in !== 'number'
		) {
			throw new Error('Fuel Finder generate_access_token returned invalid data')
		}

		this.refreshToken = generateResults.data.refresh_token
		this.accessToken = {
			value: generateResults.data.access_token,
			expires: new Date(Date.now() + generateResults.data.expires_in * 1000)
		}

		await this.db.insert(keys).values([
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
			BASE_URL + '/v1/oauth/regenerate_access_token',
			{
				method: 'POST',
				headers: {
					Accept: 'application/json',
					'Content-Type': 'application/json',
					'User-Agent': this.userAgent
				},
				body: JSON.stringify({
					client_id: this.env.FUEL_FINDER_CLIENT_ID,
					refresh_token: this.refreshToken
				})
			}
		)
		const regenerateResults = (await response.json()) as {
			error?: string
			message?: string
			access_token?: string
			expires_in?: number
		}

		if (!response.ok) {
			throw new Error(
				regenerateResults.error ??
					regenerateResults.message ??
					`Failed to regenerate Fuel Finder access token (${response.status})`
			)
		}

		if (
			typeof regenerateResults.access_token !== 'string' ||
			typeof regenerateResults.expires_in !== 'number'
		) {
			throw new Error(
				'Fuel Finder regenerate_access_token returned invalid data'
			)
		}

		this.accessToken = {
			value: regenerateResults.access_token,
			expires: new Date(Date.now() + regenerateResults.expires_in * 1000)
		}

		await this.persistAccessToken(this.accessToken)
	}
}
