import { z } from 'zod'
import { PriceQueryAreaSchema } from './PriceQueryArea'
import { PriceQueryStationFilterSchema } from './PriceQueryStationFilter'

export const PriceQueryInputSchema = z
	.object({
		fuelType: z.string().trim().min(1),
		area: PriceQueryAreaSchema.optional(),
		areas: z.array(PriceQueryAreaSchema).min(1).optional(),
		amenities: z.array(z.string().trim().min(1)).default([]),
		availableFuelTypes: z.array(z.string().trim().min(1)).default([]),
		highlightSampleSize: z.number().int().min(1).max(20).default(3),
		station: PriceQueryStationFilterSchema.optional(),
		includeClosed: z.boolean().default(false)
	})
	.superRefine((value, ctx) => {
		if (!value.area && !value.areas) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: 'Provide either area or areas.'
			})
		}
		if (value.area && value.areas) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: 'Provide either area or areas, not both.'
			})
		}
	})

export type PriceQueryInput = z.infer<typeof PriceQueryInputSchema>
