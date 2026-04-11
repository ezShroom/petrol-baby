import { z } from 'zod'

export const PriceQueryStationFilterSchema = z.object({
	nodeId: z.string().trim().min(1).optional(),
	tradingName: z.string().trim().min(1).optional(),
	brandName: z.string().trim().min(1).optional(),
	postcode: z.string().trim().min(1).optional()
})

export type PriceQueryStationFilter = z.infer<
	typeof PriceQueryStationFilterSchema
>
