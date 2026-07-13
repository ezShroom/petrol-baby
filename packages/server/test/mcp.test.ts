import { afterEach, describe, expect, test } from 'bun:test'
import {
	availableFuelType,
	dataMetadata,
	fuelStation,
	knownType,
	pricingEvent
} from '../src/db/schema'
import { handleMcpRequest } from '../src/mcp'
import { PetrolBabyService } from '../src/service'
import { DataRegion } from '../src/types/DataRegion'
import { tempDatabasePath, testConfig } from './helpers'

const MCP_HEADERS = {
	'Content-Type': 'application/json',
	Accept: 'application/json, text/event-stream'
}

function mcpRequest(body: unknown, method = 'POST'): Request {
	return new Request('http://localhost/mcp', {
		method,
		headers: MCP_HEADERS,
		body: method === 'POST' ? JSON.stringify(body) : undefined
	})
}

const INITIALIZE = {
	jsonrpc: '2.0',
	id: 1,
	method: 'initialize',
	params: {
		protocolVersion: '2025-06-18',
		capabilities: {},
		clientInfo: { name: 'test', version: '0.0.0' }
	}
}

describe('handleMcpRequest', () => {
	const cleanups: (() => Promise<void> | void)[] = []
	afterEach(async () => {
		for (const cleanup of cleanups.splice(0)) await cleanup()
	})

	async function createSeededService(): Promise<PetrolBabyService> {
		const { path, cleanup } = tempDatabasePath()
		const service = new PetrolBabyService(testConfig(path))
		cleanups.push(async () => {
			await service.close()
			cleanup()
		})

		const now = new Date()
		await service.db.insert(fuelStation).values({
			nodeId: 'station-1',
			tradingName: 'Test Garage',
			brandName: 'Testo',
			city: 'Brighton',
			country: 'England',
			postcode: 'BN1 1AA',
			latitude: 50.82,
			longitude: -0.13,
			temporarilyClosed: false,
			slug: 'testo-brighton-abc123'
		})
		await service.db.insert(knownType).values({ typeCode: 'unleaded' })
		await service.db
			.insert(availableFuelType)
			.values({ nodeId: 'station-1', typeCode: 'unleaded' })
		await service.db.insert(pricingEvent).values({
			nodeId: 'station-1',
			typeCode: 'unleaded',
			timestamp: now,
			pricePence: 139.9
		})
		await service.db.insert(dataMetadata).values([
			{ region: DataRegion.Stations, backfilledAt: now, lastUpdatedAt: now },
			{ region: DataRegion.Prices, backfilledAt: now, lastUpdatedAt: now }
		])

		return service
	}

	test('rejects non-POST methods with 405 and Allow: POST', async () => {
		const service = await createSeededService()
		for (const method of ['GET', 'DELETE', 'PUT']) {
			const response = await handleMcpRequest(service, mcpRequest(null, method))
			expect(response.status).toBe(405)
			expect(response.headers.get('allow')).toBe('POST')
		}
	})

	test('initialize succeeds statelessly (no session id issued)', async () => {
		const service = await createSeededService()
		const response = await handleMcpRequest(service, mcpRequest(INITIALIZE))
		expect(response.status).toBe(200)
		expect(response.headers.get('mcp-session-id')).toBeNull()

		const body = (await response.json()) as {
			result: { serverInfo: { name: string } }
		}
		expect(body.result.serverInfo.name).toBe('petrol-baby')
	})

	test('lists all six tools', async () => {
		const service = await createSeededService()
		const response = await handleMcpRequest(
			service,
			mcpRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
		)
		expect(response.status).toBe(200)
		const body = (await response.json()) as {
			result: { tools: { name: string }[] }
		}
		expect(body.result.tools.map((tool) => tool.name).sort()).toEqual([
			'issue_reporting_url',
			'known_amenities',
			'known_fuel_types',
			'list_prices',
			'price_history',
			'summarise_prices'
		])
	})

	test('list_prices returns the seeded station', async () => {
		const service = await createSeededService()
		const response = await handleMcpRequest(
			service,
			mcpRequest({
				jsonrpc: '2.0',
				id: 3,
				method: 'tools/call',
				params: {
					name: 'list_prices',
					arguments: {
						fuelType: 'unleaded',
						area: { scope: 'city', city: 'Brighton' }
					}
				}
			})
		)
		expect(response.status).toBe(200)
		const body = (await response.json()) as {
			result: {
				isError?: boolean
				structuredContent: {
					items: { nodeId: string; pricePence: number }[]
				}
			}
		}
		expect(body.result.isError).toBeFalsy()
		expect(body.result.structuredContent.items).toHaveLength(1)
		expect(body.result.structuredContent.items[0]?.nodeId).toBe('station-1')
		expect(body.result.structuredContent.items[0]?.pricePence).toBe(139.9)
	})

	test('price_history returns seeded events', async () => {
		const service = await createSeededService()
		const response = await handleMcpRequest(
			service,
			mcpRequest({
				jsonrpc: '2.0',
				id: 4,
				method: 'tools/call',
				params: {
					name: 'price_history',
					arguments: { nodeId: 'station-1', fuelType: 'unleaded' }
				}
			})
		)
		const body = (await response.json()) as {
			result: { structuredContent: { eventCount: number } }
		}
		expect(body.result.structuredContent.eventCount).toBe(1)
	})

	test('tools report a friendly error while data is still backfilling', async () => {
		const { path, cleanup } = tempDatabasePath()
		const service = new PetrolBabyService(testConfig(path))
		cleanups.push(async () => {
			await service.close()
			cleanup()
		})

		const response = await handleMcpRequest(
			service,
			mcpRequest({
				jsonrpc: '2.0',
				id: 5,
				method: 'tools/call',
				params: {
					name: 'list_prices',
					arguments: { fuelType: 'unleaded', area: { scope: 'all_uk' } }
				}
			})
		)
		const body = (await response.json()) as {
			result: { isError?: boolean; content: { text: string }[] }
		}
		expect(body.result.isError).toBe(true)
		expect(body.result.content[0]?.text).toContain('still being backfilled')
	})

	test('concurrent requests with identical JSON-RPC ids do not interfere', async () => {
		const service = await createSeededService()
		// The old shared-session Durable Object deployment could misroute
		// these; stateless per-request servers must not.
		const requests = Array.from({ length: 8 }, () =>
			handleMcpRequest(
				service,
				mcpRequest({ jsonrpc: '2.0', id: 42, method: 'tools/list' })
			)
		)
		const responses = await Promise.all(requests)
		for (const response of responses) {
			expect(response.status).toBe(200)
			const body = (await response.json()) as {
				id: number
				result: { tools: unknown[] }
			}
			expect(body.id).toBe(42)
			expect(body.result.tools).toHaveLength(6)
		}
	})
})
