import { z } from 'zod'
import { PriceQueryAreaSchema } from './PriceQueryArea'
import { PriceQueryStationFilterSchema } from './PriceQueryStationFilter'

export const NormalizedPriceQuerySchema = z.object({
	fuelType: z.string().min(1),
	areas: z.array(PriceQueryAreaSchema).min(1),
	amenities: z.array(z.string().min(1)),
	availableFuelTypes: z.array(z.string().min(1)),
	highlightSampleSize: z.number().int().min(1).max(20),
	station: PriceQueryStationFilterSchema.nullable(),
	includeClosed: z.boolean()
})

export type NormalizedPriceQuery = z.infer<typeof NormalizedPriceQuerySchema>
