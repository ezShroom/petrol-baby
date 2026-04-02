import { z } from 'zod'
import { ClosureType } from './ClosureType'

export const OutputCorrectableStationDataSchema = z.object({
	nodeId: z
		.string()
		.describe('Fuel Finder node ID associated with this station'),
	tradingName: z
		.string()
		.describe(
			"A human-friendly name to identify this specific station, potentially including the brand name and place - for example, 'Asda Petrol East Retford' or 'JET Thamesmead Service Station'."
		),
	brandName: z
		.string()
		.describe(
			"A human-friendly **brand name only** - for example, 'Asda' or 'JET'. Follow the guidel"
		),
	closure: z.enum(ClosureType).nullable()
})
