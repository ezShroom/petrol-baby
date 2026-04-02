import { z } from 'zod'
import { ClosureType } from './ClosureType'

export const OutputCorrectableStationDataSchema = z.object({
	nodeIds: z.array(z.string()),
	tradingName: z.string(),
	brandName: z.string(),
	closure: z.enum(ClosureType).nullable()
})
