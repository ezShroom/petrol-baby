import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { z } from 'zod'
import { version } from '../package.json'
import { REPORTING_URL } from './constants'
import { normalizePriceQuery } from './query/normalize_price_query'
import { buildListPricesText, buildSummaryText } from './query/price_query_text'
import {
	collectSummaryStations,
	summarisePriceRows
} from './query/price_summary'
import { PRICING_EVENT_RETENTION_MS, type PetrolBabyService } from './service'
import { ListPricesOutputSchema } from './types/ListPricesOutput'
import { PriceHistoryInputSchema } from './types/PriceHistoryInput'
import { PriceHistoryOutputSchema } from './types/PriceHistoryOutput'
import { PriceQueryInputSchema } from './types/PriceQueryInput'
import { SummarisePricesOutputSchema } from './types/SummarisePricesOutput'

const LIST_RESULTS_LIMIT = 20
const LIST_RESULTS_FETCH_LIMIT = LIST_RESULTS_LIMIT + 1
const PRICE_HISTORY_LIMIT = 500

/**
 * Build a fresh MCP server wired to the shared data service. One server is
 * created per HTTP request (stateless Streamable HTTP): the tools are plain
 * request/response database queries with no session state, notifications, or
 * subscriptions, so there is nothing worth keeping alive between requests —
 * and, unlike the old shared-Durable-Object setup, clients can no longer
 * interfere with each other or with the database lifecycle.
 */
export function createMcpServer(service: PetrolBabyService): McpServer {
	const server = new McpServer({
		name: 'petrol-baby',
		version
	})

	server.registerTool(
		'issue_reporting_url',
		{
			title: 'Issue reporting URL',
			description:
				'Get the URL for reporting issues with data. Use this only if the user specifically says that data returned from fuel.baby is incorrect or outdated.',
			outputSchema: {
				url: z.url()
			}
		},
		async () => ({
			content: [
				{
					type: 'text',
					text: REPORTING_URL
				}
			],
			structuredContent: {
				url: REPORTING_URL
			}
		})
	)
	server.registerTool(
		'known_fuel_types',
		{
			title: 'Known fuel types',
			description:
				'Return the currently known fuel type codes that can be used in fuel price queries.',
			outputSchema: z.object({
				fuelTypes: z.array(z.string())
			})
		},
		async () => {
			const fuelTypes = await service.priceQuery.listKnownCodes('known_type')
			return {
				content: [
					{
						type: 'text',
						text:
							fuelTypes.length === 0
								? 'No known fuel types have been loaded yet.'
								: `Known fuel types: ${fuelTypes.join(', ')}`
					}
				],
				structuredContent: { fuelTypes }
			}
		}
	)
	server.registerTool(
		'known_amenities',
		{
			title: 'Known amenities',
			description:
				'Return the currently known amenity codes that can be used as station filters.',
			outputSchema: z.object({
				amenities: z.array(z.string())
			})
		},
		async () => {
			const amenities = await service.priceQuery.listKnownCodes('known_amenity')
			return {
				content: [
					{
						type: 'text',
						text:
							amenities.length === 0
								? 'No known amenities have been loaded yet.'
								: `Known amenities: ${amenities.join(', ')}`
					}
				],
				structuredContent: { amenities }
			}
		}
	)
	server.registerTool(
		'list_prices',
		{
			title: 'List fuel prices',
			description:
				'Find actual stations and their price for one fuel type. Returns up to 20 stations, sorted cheapest first, and clearly flags when more stations matched. If the list is truncated, use summarise_prices to work with larger matching sets. Use the optional `at` parameter (ISO-8601 timestamp) to query prices as they were at a specific point in time (up to 14 days of history available).',
			inputSchema: PriceQueryInputSchema,
			outputSchema: ListPricesOutputSchema
		},
		async (input) => {
			await service.ensurePriceQueryDataReady()
			const query = normalizePriceQuery(input)
			const baseRows = await service.priceQuery.queryCurrentPriceRows(
				query,
				LIST_RESULTS_FETCH_LIMIT
			)
			const isTruncated = baseRows.length > LIST_RESULTS_LIMIT
			const hydratedRows = await service.priceQuery.hydrateStationPriceRows(
				query,
				baseRows.slice(0, LIST_RESULTS_LIMIT)
			)
			const result: z.infer<typeof ListPricesOutputSchema> = {
				query,
				items: hydratedRows,
				returnedCount: hydratedRows.length,
				isTruncated,
				truncationMessage: isTruncated
					? 'More than 20 stations matched this query, so only the first 20 cheapest results are included. Use summarise_prices if you need to work across the full matching set.'
					: null,
				matchedCountLowerBound: isTruncated
					? LIST_RESULTS_FETCH_LIMIT
					: hydratedRows.length,
				sort: 'price_ascending'
			}

			return {
				content: [
					{
						type: 'text',
						text: buildListPricesText(result)
					}
				],
				structuredContent: result
			}
		}
	)
	server.registerTool(
		'summarise_prices',
		{
			title: 'Summarise fuel prices',
			description:
				'Summarise prices for the same query model as list_prices. Returns min, max, mean, quartiles, and median, with real stations attached to the highlighted observed prices. Use highlightSampleSize to ask for a fuzzier set of nearby stations around each highlighted point. Use the optional `at` parameter (ISO-8601 timestamp) to summarise prices as they were at a specific point in time (up to 14 days of history available).',
			inputSchema: PriceQueryInputSchema,
			outputSchema: SummarisePricesOutputSchema
		},
		async (input) => {
			await service.ensurePriceQueryDataReady()
			const query = normalizePriceQuery(input)
			const baseRows = await service.priceQuery.queryCurrentPriceRows(query)
			const rows = service.priceQuery.buildUnhydratedRows(query, baseRows)
			const result = summarisePriceRows(query, rows)
			// Only the stations surfaced on the highlighted price points need
			// their relations; hydrate just those rather than every match.
			await service.priceQuery.hydrateStationsInPlace(
				collectSummaryStations(result)
			)

			return {
				content: [
					{
						type: 'text',
						text: buildSummaryText(result)
					}
				],
				structuredContent: result
			}
		}
	)

	server.registerTool(
		'price_history',
		{
			title: 'Station price history',
			description:
				"Get the pricing history for a specific station and fuel type over time. Returns timestamped price events in reverse chronological order. Use this to see how a station's price has changed, or to compare historical trends. Up to 14 days of history is available. Obtain the station nodeId from a list_prices or summarise_prices result first.",
			inputSchema: PriceHistoryInputSchema,
			outputSchema: PriceHistoryOutputSchema
		},
		async (input) => {
			await service.ensurePriceQueryDataReady()
			const station = await service.priceQuery.lookupStation(input.nodeId)
			if (!station) {
				return {
					content: [
						{
							type: 'text',
							text: `No station found with nodeId "${input.nodeId}".`
						}
					],
					structuredContent: {
						nodeId: input.nodeId,
						tradingName: null,
						brandName: null,
						postcode: null,
						fuelType: input.fuelType,
						from:
							input.from ??
							new Date(Date.now() - PRICING_EVENT_RETENTION_MS).toISOString(),
						to: input.to ?? new Date().toISOString(),
						events: [],
						eventCount: 0,
						isTruncated: false
					}
				}
			}

			const fromDate = input.from
				? new Date(input.from)
				: new Date(Date.now() - PRICING_EVENT_RETENTION_MS)
			const toDate = input.to ? new Date(input.to) : new Date()
			const fetchLimit = PRICE_HISTORY_LIMIT + 1

			const events = await service.priceQuery.queryStationPriceHistory({
				nodeId: input.nodeId,
				fuelType: input.fuelType,
				from: fromDate,
				to: toDate,
				limit: fetchLimit
			})

			const isTruncated = events.length > PRICE_HISTORY_LIMIT
			const returnedEvents = events.slice(0, PRICE_HISTORY_LIMIT)
			const stationLabel =
				station.tradingName ?? station.brandName ?? station.nodeId
			const postcodeLabel = station.postcode ? ` (${station.postcode})` : ''

			const result: z.infer<typeof PriceHistoryOutputSchema> = {
				nodeId: station.nodeId,
				tradingName: station.tradingName,
				brandName: station.brandName,
				postcode: station.postcode,
				fuelType: input.fuelType,
				from: fromDate.toISOString(),
				to: toDate.toISOString(),
				events: returnedEvents,
				eventCount: returnedEvents.length,
				isTruncated
			}

			const lines: string[] = []
			if (returnedEvents.length === 0) {
				lines.push(
					`No ${input.fuelType} price history found for ${stationLabel}${postcodeLabel} in the requested time range.`
				)
			} else {
				lines.push(
					`${returnedEvents.length} ${input.fuelType} price event${returnedEvents.length === 1 ? '' : 's'} for ${stationLabel}${postcodeLabel}.`
				)
				if (isTruncated) {
					lines.push(
						`Results truncated to ${PRICE_HISTORY_LIMIT} events. Narrow the time range for more detail.`
					)
				}
			}

			return {
				content: [{ type: 'text', text: lines.join(' ') }],
				structuredContent: result
			}
		}
	)

	return server
}

function methodNotAllowed(): Response {
	return new Response(
		JSON.stringify({
			jsonrpc: '2.0',
			error: { code: -32000, message: 'Method not allowed.' },
			id: null
		}),
		{
			status: 405,
			headers: {
				'Content-Type': 'application/json',
				Allow: 'POST'
			}
		}
	)
}

/**
 * Handle one HTTP request against the MCP endpoint.
 *
 * Stateless mode: a fresh transport and a fresh `McpServer` per POST (the
 * SDK requires both — a connected server cannot be re-attached, and a
 * stateless transport refuses reuse). Responses are plain JSON rather than
 * SSE. GET (server-initiated streams) and DELETE (session termination) have
 * no meaning without sessions and return 405.
 */
export async function handleMcpRequest(
	service: PetrolBabyService,
	request: Request
): Promise<Response> {
	if (request.method !== 'POST') {
		return methodNotAllowed()
	}

	const transport = new WebStandardStreamableHTTPServerTransport({
		sessionIdGenerator: undefined,
		enableJsonResponse: true
	})
	const server = createMcpServer(service)
	await server.connect(transport)

	try {
		// JSON mode: the returned Response body is fully materialised, so it
		// is safe to tear the pair down immediately afterwards.
		return await transport.handleRequest(request)
	} finally {
		void transport.close().catch(() => {})
		void server.close().catch(() => {})
	}
}
