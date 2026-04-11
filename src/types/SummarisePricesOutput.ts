import { z } from 'zod'
import { MedianSummarySchema } from './MedianSummary'
import { NormalizedPriceQuerySchema } from './NormalizedPriceQuery'
import { ObservedPricePointSchema } from './ObservedPricePoint'

export const SummarisePricesOutputSchema = z.object({
	query: NormalizedPriceQuerySchema,
	stationCount: z.number().int().nonnegative(),
	minimum: ObservedPricePointSchema.nullable(),
	maximum: ObservedPricePointSchema.nullable(),
	meanPricePence: z.number().nullable(),
	lowerQuartile: ObservedPricePointSchema.nullable(),
	median: MedianSummarySchema,
	upperQuartile: ObservedPricePointSchema.nullable(),
	notes: z.array(z.string())
})

export type SummarisePricesOutput = z.infer<typeof SummarisePricesOutputSchema>
