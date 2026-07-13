type JsonResponseOptions = {
	context: string
}

export async function parseJsonResponse<T>(
	response: Response,
	options: JsonResponseOptions
): Promise<T> {
	const contentType = response.headers.get('content-type') ?? 'unknown'
	const body = await response.text()

	if (!body.length) {
		console.error(
			`Expected JSON from ${options.context}, but received an empty response body`,
			{
				status: response.status,
				statusText: response.statusText,
				contentType
			}
		)
		throw new Error(
			`Expected JSON from ${options.context}, but response was empty`
		)
	}

	try {
		return JSON.parse(body) as T
	} catch (e) {
		console.error(
			`Expected JSON from ${options.context}, but received non-JSON`,
			{
				status: response.status,
				statusText: response.statusText,
				contentType
			}
		)
		console.error(body)
		throw new Error(
			`Expected JSON from ${options.context}, but received ${contentType}`,
			{
				cause: e
			}
		)
	}
}
