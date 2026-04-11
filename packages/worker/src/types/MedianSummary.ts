import { z } from 'zod'
import { ObservedPricePointSchema } from './ObservedPricePoint'
import { StationPriceResultSchema } from './StationPriceResult'

export const MedianSummarySchema = z.discriminatedUnion('kind', [
	z.object({
		kind: z.literal('none')
	}),
	z.object({
		kind: z.literal('single'),
		pricePence: z.number(),
		stations: z.array(StationPriceResultSchema),
		nearbyStations: z.array(StationPriceResultSchema),
		requestedStationCount: z.number().int().min(1)
	}),
	z.object({
		kind: z.literal('pair'),
		lower: ObservedPricePointSchema,
		upper: ObservedPricePointSchema
	})
])

export type MedianSummary = z.infer<typeof MedianSummarySchema>
