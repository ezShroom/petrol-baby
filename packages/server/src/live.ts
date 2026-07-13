import type { BackfillPriceRecord } from './data/price_helper'

const HEARTBEAT_INTERVAL_MS = 25_000

type Subscriber = {
	nodeId: string
	controller: ReadableStreamDefaultController<Uint8Array>
}

const encoder = new TextEncoder()

/**
 * In-process fan-out for live price updates, replacing the Durable Object's
 * hibernatable WebSockets. Browsers subscribe with `EventSource`; each
 * subscriber is a plain SSE `ReadableStream`. State is only a Map, so a
 * process restart simply drops connections and EventSource reconnects.
 */
export class LiveHub {
	private subscribers = new Map<string, Set<Subscriber>>()
	private heartbeat: ReturnType<typeof setInterval> | null = null
	private closed = false

	/** Total open subscriber streams (for tests and diagnostics). */
	get size(): number {
		let total = 0
		for (const set of this.subscribers.values()) total += set.size
		return total
	}

	/**
	 * Create an SSE stream for one station. The caller is responsible for
	 * wiring `signal` (request abort) — cancellation of the stream itself is
	 * handled here.
	 */
	subscribe(nodeId: string, signal?: AbortSignal): ReadableStream<Uint8Array> {
		if (this.closed) {
			throw new Error('LiveHub is closed')
		}

		let subscriber: Subscriber | null = null
		const unsubscribe = () => {
			if (!subscriber) return
			const set = this.subscribers.get(nodeId)
			set?.delete(subscriber)
			if (set && set.size === 0) this.subscribers.delete(nodeId)
			subscriber = null
		}

		return new ReadableStream<Uint8Array>({
			start: (controller) => {
				subscriber = { nodeId, controller }
				let set = this.subscribers.get(nodeId)
				if (!set) {
					set = new Set()
					this.subscribers.set(nodeId, set)
				}
				set.add(subscriber)
				this.ensureHeartbeat()

				// Ask EventSource to wait 5s before reconnecting, and confirm
				// the subscription immediately so intermediaries flush headers.
				controller.enqueue(encoder.encode('retry: 5000\n\n: connected\n\n'))

				signal?.addEventListener('abort', () => {
					unsubscribe()
					try {
						controller.close()
					} catch {
						/* already closed */
					}
				})
			},
			cancel: () => {
				unsubscribe()
			}
		})
	}

	/**
	 * Push freshly ingested prices to any subscribers watching the affected
	 * stations. Best-effort: never throws into the ingest path. Payload shape
	 * matches the old WebSocket messages so the client change is minimal.
	 */
	broadcast(events: BackfillPriceRecord[]): void {
		try {
			if (this.subscribers.size === 0 || events.length === 0) return

			const latestByNode = new Map<
				string,
				Map<string, { pricePence: number; timestamp: Date }>
			>()
			for (const event of events) {
				if (!event.nodeId) continue
				if (!this.subscribers.has(event.nodeId)) continue
				let byType = latestByNode.get(event.nodeId)
				if (!byType) {
					byType = new Map()
					latestByNode.set(event.nodeId, byType)
				}
				const existing = byType.get(event.typeCode)
				if (!existing || event.timestamp > existing.timestamp) {
					byType.set(event.typeCode, {
						pricePence: event.pricePence,
						timestamp: event.timestamp
					})
				}
			}

			for (const [nodeId, byType] of latestByNode) {
				const set = this.subscribers.get(nodeId)
				if (!set || set.size === 0) continue
				for (const [typeCode, value] of byType) {
					const payload = JSON.stringify({
						type: 'price',
						fuelType: typeCode,
						pricePence: value.pricePence,
						timestamp: value.timestamp.toISOString()
					})
					this.send(set, `data: ${payload}\n\n`)
				}
			}
		} catch (error) {
			console.error('Failed to broadcast live prices:', error)
		}
	}

	/** Close every open stream, e.g. during graceful shutdown. */
	close(): void {
		this.closed = true
		if (this.heartbeat) {
			clearInterval(this.heartbeat)
			this.heartbeat = null
		}
		for (const set of this.subscribers.values()) {
			for (const subscriber of set) {
				try {
					subscriber.controller.close()
				} catch {
					/* already closed */
				}
			}
		}
		this.subscribers.clear()
	}

	private ensureHeartbeat(): void {
		if (this.heartbeat) return
		this.heartbeat = setInterval(() => {
			if (this.subscribers.size === 0) {
				if (this.heartbeat) clearInterval(this.heartbeat)
				this.heartbeat = null
				return
			}
			for (const set of this.subscribers.values()) {
				this.send(set, ': ping\n\n')
			}
		}, HEARTBEAT_INTERVAL_MS)
		// Never keep the process alive just for heartbeats.
		this.heartbeat.unref?.()
	}

	private send(set: Set<Subscriber>, frame: string): void {
		const bytes = encoder.encode(frame)
		for (const subscriber of [...set]) {
			try {
				subscriber.controller.enqueue(bytes)
			} catch {
				// Stream already closed/cancelled — drop the subscriber.
				set.delete(subscriber)
				if (set.size === 0) {
					this.subscribers.delete(subscriber.nodeId)
				}
			}
		}
	}
}
