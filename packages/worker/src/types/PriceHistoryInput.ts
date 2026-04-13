import { z } from 'zod'

export const PriceHistoryInputSchema = z.object({
	nodeId: z
		.string()
		.trim()
		.min(1)
		.describe(
			'The station node ID. Obtain this from a list_prices or summarise_prices result.'
		),
	fuelType: z.string().trim().min(1),
	from: z
		.string()
		.datetime()
		.describe(
			'Optional ISO-8601 start of the time range (inclusive). Defaults to 14 days ago.'
		)
		.optional(),
	to: z
		.string()
		.datetime()
		.describe(
			'Optional ISO-8601 end of the time range (inclusive). Defaults to now.'
		)
		.optional()
})

export type PriceHistoryInput = z.infer<typeof PriceHistoryInputSchema>
