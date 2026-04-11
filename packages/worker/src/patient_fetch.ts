import { ms } from 'ms'

const TIME_BETWEEN_REQUESTS = ms('60s') / 30 // 30 requests per minute allowed

let lastRequestEnd = 0
let queue: Promise<unknown> = Promise.resolve()

export function patientFetch(
	...args: Parameters<typeof fetch>
): Promise<Response> {
	const promise = queue.then(async () => {
		const elapsed = performance.now() - lastRequestEnd
		if (elapsed < TIME_BETWEEN_REQUESTS) {
			await new Promise((resolve) =>
				setTimeout(resolve, TIME_BETWEEN_REQUESTS - elapsed)
			)
		}

		const response = await fetch(...args)
		lastRequestEnd = performance.now()
		return response
	})

	// Advance the queue but never let a rejection block subsequent requests
	queue = promise.catch(() => {})

	return promise
}
