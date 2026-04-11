import { z } from 'zod'

const UK_COUNTRIES = [
	'England',
	'Wales',
	'Scotland',
	'Northern Ireland'
] as const

const CountrySchema = z.enum(UK_COUNTRIES)

export const PriceQueryAreaSchema = z.discriminatedUnion('scope', [
	z.object({
		scope: z.literal('all_uk')
	}),
	z.object({
		scope: z.literal('country'),
		country: CountrySchema
	}),
	z.object({
		scope: z.literal('city'),
		city: z.string().trim().min(1),
		country: CountrySchema.optional()
	}),
	z.object({
		scope: z.literal('postcode'),
		postcode: z.string().trim().min(1)
	}),
	z.object({
		scope: z.literal('postcode_prefix'),
		prefix: z.string().trim().min(1)
	})
])

export type PriceQueryArea = z.infer<typeof PriceQueryAreaSchema>
