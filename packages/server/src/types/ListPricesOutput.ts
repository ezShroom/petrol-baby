import { z } from 'zod'
import { NormalizedPriceQuerySchema } from './NormalizedPriceQuery'
import { StationPriceResultSchema } from './StationPriceResult'

export const ListPricesOutputSchema = z.object({
	query: NormalizedPriceQuerySchema,
	items: z.array(StationPriceResultSchema),
	returnedCount: z.number().int().nonnegative(),
	isTruncated: z.boolean(),
	truncationMessage: z.string().nullable(),
	matchedCountLowerBound: z.number().int().nonnegative(),
	sort: z.literal('price_ascending')
})

export type ListPricesOutput = z.infer<typeof ListPricesOutputSchema>
