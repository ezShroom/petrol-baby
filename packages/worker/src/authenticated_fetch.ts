import { StatusCodes } from 'http-status-codes'
import { PERSISTENT_ACCESS_TOKEN_REFRESH_WINDOW_MS } from './constants'
import type { FuelFinderOAuth } from './oauth'
import { patientFetch } from './patient_fetch'

type AuthenticatedPatientFetchOptions = {
	refreshWindowMs?: number
}

function withAuthorizationHeader(
	init: RequestInit | undefined,
	accessToken: string
): RequestInit {
	const headers = new Headers(init?.headers)
	headers.set('Authorization', `Bearer ${accessToken}`)

	return {
		...init,
		headers
	}
}

export async function authenticatedPatientFetch(
	oauth: FuelFinderOAuth,
	input: RequestInfo | URL,
	init?: RequestInit,
	options: AuthenticatedPatientFetchOptions = {}
): Promise<Response> {
	const refreshWindowMs =
		options.refreshWindowMs ?? PERSISTENT_ACCESS_TOKEN_REFRESH_WINDOW_MS

	await oauth.ensureAccessToken(refreshWindowMs)
	if (!oauth.accessToken) {
		throw new Error('Unable to acquire Fuel Finder access token')
	}

	let response = await patientFetch(
		input,
		withAuthorizationHeader(init, oauth.accessToken.value)
	)
	if (response.status !== StatusCodes.FORBIDDEN) {
		return response
	}

	console.warn('Protected Fuel Finder endpoint returned 403, refreshing token')
	await oauth.forceRefreshAccessToken()
	if (!oauth.accessToken) {
		throw new Error('Unable to refresh Fuel Finder access token after 403')
	}

	response = await patientFetch(
		input,
		withAuthorizationHeader(init, oauth.accessToken.value)
	)

	return response
}
