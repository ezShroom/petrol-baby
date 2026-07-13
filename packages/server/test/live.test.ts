import { describe, expect, test } from 'bun:test'
import { LiveHub } from '../src/live'

/**
 * Structural reader type: Bun's and Node's ReadableStreamDefaultReader
 * declarations disagree (readMany), so tests accept anything readable.
 */
type ByteReader = {
	read(): Promise<{ done: boolean; value?: Uint8Array }>
	cancel(): Promise<unknown>
}

async function readAvailable(
	reader: ByteReader,
	minBytes: number,
	timeoutMs = 1000
): Promise<string> {
	const decoder = new TextDecoder()
	let out = ''
	const deadline = Date.now() + timeoutMs
	while (out.length < minBytes && Date.now() < deadline) {
		const race = await Promise.race([
			reader.read(),
			new Promise<'timeout'>((resolve) =>
				setTimeout(() => resolve('timeout'), deadline - Date.now())
			)
		])
		if (race === 'timeout' || race.done) break
		if (race.value) out += decoder.decode(race.value)
	}
	return out
}

function priceEvent(
	nodeId: string,
	pricePence: number,
	timestamp = new Date()
) {
	return { nodeId, typeCode: 'unleaded', timestamp, pricePence }
}

describe('LiveHub', () => {
	test('sends the retry hint and connection comment on subscribe', async () => {
		const hub = new LiveHub()
		const reader = hub.subscribe('s1').getReader()
		const text = await readAvailable(reader, 10)
		expect(text).toContain('retry: 5000')
		expect(text).toContain(': connected')
		hub.close()
	})

	test('broadcasts only to subscribers of the affected station', async () => {
		const hub = new LiveHub()
		const watching = hub.subscribe('s1').getReader()
		const other = hub.subscribe('s2').getReader()

		await readAvailable(watching, 10)
		await readAvailable(other, 10)

		hub.broadcast([priceEvent('s1', 141.2)])

		const received = await readAvailable(watching, 20)
		expect(received).toContain('"type":"price"')
		expect(received).toContain('"pricePence":141.2')

		const nothing = await readAvailable(other, 20, 150)
		expect(nothing).toBe('')
		hub.close()
	})

	test('keeps only the latest event per station/fuel in one broadcast', async () => {
		const hub = new LiveHub()
		const reader = hub.subscribe('s1').getReader()
		await readAvailable(reader, 10)

		const older = new Date(Date.now() - 60_000)
		hub.broadcast([
			priceEvent('s1', 150, older),
			priceEvent('s1', 139.9, new Date())
		])

		const received = await readAvailable(reader, 20)
		expect(received).toContain('139.9')
		expect(received).not.toContain('"pricePence":150')
		hub.close()
	})

	test('cancelled streams are removed from the hub', async () => {
		const hub = new LiveHub()
		const stream = hub.subscribe('s1')
		const reader = stream.getReader()
		await readAvailable(reader, 10)
		expect(hub.size).toBe(1)

		await reader.cancel()
		expect(hub.size).toBe(0)

		// Broadcasting after cancellation must be a no-op, not a crash.
		hub.broadcast([priceEvent('s1', 140)])
		hub.close()
	})

	test('abort signal unsubscribes', async () => {
		const hub = new LiveHub()
		const controller = new AbortController()
		const reader = hub.subscribe('s1', controller.signal).getReader()
		await readAvailable(reader, 10)
		expect(hub.size).toBe(1)

		controller.abort()
		expect(hub.size).toBe(0)
		hub.close()
	})

	test('close() ends every stream and refuses new subscribers', async () => {
		const hub = new LiveHub()
		const reader = hub.subscribe('s1').getReader()
		await readAvailable(reader, 10)

		hub.close()
		const result = await reader.read()
		expect(result.done).toBe(true)
		expect(() => hub.subscribe('s2')).toThrow(/closed/)
	})
})
