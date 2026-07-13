/**
 * Map over items with at most `concurrency` handlers in flight. Results keep
 * input order. The first rejection aborts scheduling of new work and
 * propagates once in-flight items settle.
 */
export async function mapWithConcurrency<T, R>(
	items: readonly T[],
	concurrency: number,
	fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
	if (items.length === 0) return []
	const limit = Math.max(1, Math.min(concurrency, items.length))
	const results = new Array<R>(items.length)
	let nextIndex = 0
	let failure: unknown = null
	let failed = false

	async function worker(): Promise<void> {
		while (true) {
			if (failed) return
			const index = nextIndex++
			if (index >= items.length) return
			try {
				results[index] = await fn(items[index] as T, index)
			} catch (error) {
				if (!failed) {
					failed = true
					failure = error
				}
				return
			}
		}
	}

	await Promise.all(Array.from({ length: limit }, () => worker()))
	if (failed) throw failure
	return results
}

/** Sleep helper with full-jitter exponential backoff support. */
export function backoffDelayMs(
	attempt: number,
	{ baseMs = 1000, maxMs = 30_000 }: { baseMs?: number; maxMs?: number } = {}
): number {
	const cap = Math.min(maxMs, baseMs * 2 ** (attempt - 1))
	return Math.floor(Math.random() * cap)
}
