import { z } from 'zod'

// ─── Name Correction (Pass 1) ───────────────────────────────────────────────

export const NameCorrectionInputSchema = z.object({
	id: z.number().describe('Sequential station ID for this batch'),
	tradingName: z.string(),
	brandName: z.string(),
	isSupermarket: z.boolean(),
	isMotorway: z.boolean(),
	address1: z.string().nullable().describe('Address context — do not correct'),
	address2: z.string().nullable().describe('Address context — do not correct'),
	city: z.string().nullable().describe('Address context — do not correct'),
	postcode: z.string().nullable().describe('Address context — do not correct')
})
export type NameCorrectionInput = z.infer<typeof NameCorrectionInputSchema>

export const NameCorrectionOutputSchema = z.object({
	id: z.number().describe('Sequential station ID — must match the input'),
	tradingName: z
		.string()
		.min(1)
		.describe(
			"A human-friendly name to identify this specific station, including the brand and place — e.g. 'Asda Petrol East Retford' or 'JET Thamesmead Service Station'."
		),
	brandName: z
		.string()
		.min(1)
		.describe(
			"The brand name only, minimal — e.g. 'Asda', 'JET', 'BP'. Not the trading name."
		)
})
export type NameCorrectionOutput = z.infer<typeof NameCorrectionOutputSchema>

export const NameCorrectionOutputArrayJSONSchema = z.toJSONSchema(
	z.object({
		stations: z.array(NameCorrectionOutputSchema)
	}),
	{ target: 'openapi-3.0' }
)

// ─── Address Correction (Pass 2) ────────────────────────────────────────────

export const AddressCorrectionInputSchema = z.object({
	id: z.number().describe('Sequential station ID for this batch'),
	tradingName: z
		.string()
		.describe('Already-corrected trading name, for geographic context'),
	address1: z.string().nullable(),
	address2: z.string().nullable(),
	city: z.string().nullable(),
	country: z.string().describe('Best-guess country from postcode area'),
	postcode: z.string().nullable(),
	latitude: z.number(),
	longitude: z.number()
})
export type AddressCorrectionInput = z.infer<
	typeof AddressCorrectionInputSchema
>

export const AddressCorrectionOutputSchema = z.object({
	id: z.number().describe('Sequential station ID — must match the input'),
	address1: z.string().min(1).describe('Address line 1'),
	address2: z
		.string()
		.min(1)
		.nullable()
		.describe('Address line 2, or null if not applicable'),
	city: z.string().min(1).nullable().describe('City/town, or null if unknown'),
	country: z.union([
		z.literal('England'),
		z.literal('Wales'),
		z.literal('Scotland'),
		z.literal('Northern Ireland')
	]),
	postcode: z
		.string()
		.min(2)
		.describe(
			'Full postcode (outcode + incode with space), or outcode-only if the full postcode is implausible'
		)
})
export type AddressCorrectionOutput = z.infer<
	typeof AddressCorrectionOutputSchema
>

export const AddressCorrectionOutputArrayJSONSchema = z.toJSONSchema(
	z.object({
		stations: z.array(AddressCorrectionOutputSchema)
	}),
	{ target: 'openapi-3.0' }
)
