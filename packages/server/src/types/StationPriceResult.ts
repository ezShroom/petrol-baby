import { z } from 'zod'

export const StationPriceResultSchema = z.object({
	nodeId: z.string(),
	tradingName: z.string().nullable(),
	brandName: z.string().nullable(),
	address1: z.string().nullable(),
	address2: z.string().nullable(),
	city: z.string().nullable(),
	country: z.string().nullable(),
	postcode: z.string().nullable(),
	pricePence: z.number(),
	fuelType: z.string(),
	priceTimestamp: z.string(),
	amenities: z.array(z.string()),
	availableFuelTypes: z.array(z.string())
})

export type StationPriceResult = z.infer<typeof StationPriceResultSchema>
