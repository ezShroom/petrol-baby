import { ClosureType } from './ClosureType'
import { z } from 'zod'

export const OutputCorrectableStationDataSchema = z.object({
	nodeIds: z.array(z.string()),
	tradingName: z.string(),
	brandName: z.string(),
	closure: z.enum(ClosureType).nullable()
})
