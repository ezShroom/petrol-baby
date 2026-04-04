import { z } from 'zod'

export const InputCorrectableStationDataSchema = z.object({
	nodeId: z.hex(),
	tradingName: z.string(),
	brandName: z.string(),
	phone: z.string().nullable(),
	isMotorwayServiceStation: z.boolean(),
	isSupermarketServiceStation: z.boolean(),
	address: z.object({
		address1: z.string().nullable(),
		address2: z.string().nullable(),
		city: z.string().nullable(),
		county: z.string().nullable(),
		country: z.string().nullable(),
		postcode: z.string().nullable()
	}),
	coords: z.object({
		latitude: z.number(),
		longitude: z.number()
	})
})
export type InputCorrectableStationData = z.infer<
	typeof InputCorrectableStationDataSchema
>

export const OutputCorrectableStationDataSchema = z.object({
	nodeId: z
		.string()
		.describe('Fuel Finder node ID associated with this station'),
	tradingName: z
		.string()
		.describe(
			"A human-friendly name to identify this specific station, potentially including the place - for example, 'Asda Petrol East Retford' or 'JET Thamesmead Service Station'. Make this recognisable."
		),
	brandName: z
		.string()
		.describe(
			"A human-friendly **brand name only** - for example, 'Asda' or 'JET'."
		),
	phone: z.string().nullable(),
	address: z.object({
		address1: z.string().describe('Address Line 1'),
		address2: z.string().nullable().describe('Address line 2'),
		city: z.string().nullable(),
		country: z.union([
			z.literal('England'),
			z.literal('Wales'),
			z.literal('Scotland'),
			z.literal('Northern Ireland')
		]),
		postcode: z
			.string()
			.describe('Full postcode with a space between the outcode and incode')
	}),
	coords: z.object({
		latitude: z.number(),
		longitude: z.number()
	}),
	potentialDuplicates: z
		.array(z.string())
		.nullable()
		.describe('Array of node IDs of potential duplicate stations')
})
export const OutputCorrectableStationDataArrayJSONSchema = z.toJSONSchema(
	z.object({
		stations: z.array(OutputCorrectableStationDataSchema)
	}),
	{ target: 'openapi-3.0' }
)
export type OutputCorrectableStationData = z.infer<
	typeof OutputCorrectableStationDataSchema
>
