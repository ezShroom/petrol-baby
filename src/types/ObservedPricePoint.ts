import { z } from 'zod'
import { StationPriceResultSchema } from './StationPriceResult'

export const ObservedPricePointSchema = z.object({
	pricePence: z.number(),
	stations: z.array(StationPriceResultSchema),
	nearbyStations: z.array(StationPriceResultSchema),
	requestedStationCount: z.number().int().min(1)
})

export type ObservedPricePoint = z.infer<typeof ObservedPricePointSchema>
