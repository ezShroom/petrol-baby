import { z } from 'zod'

export const PriceHistoryEventSchema = z.object({
	timestamp: z.string().datetime(),
	pricePence: z.number()
})

export const PriceHistoryOutputSchema = z.object({
	nodeId: z.string(),
	tradingName: z.string().nullable(),
	brandName: z.string().nullable(),
	postcode: z.string().nullable(),
	fuelType: z.string(),
	from: z.string().datetime(),
	to: z.string().datetime(),
	events: z.array(PriceHistoryEventSchema),
	eventCount: z.number().int().nonnegative(),
	isTruncated: z.boolean()
})

export type PriceHistoryOutput = z.infer<typeof PriceHistoryOutputSchema>
