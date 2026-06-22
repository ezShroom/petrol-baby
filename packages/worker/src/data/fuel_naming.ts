/**
 * Friendly fuel naming and "forecourt sign" headline selection.
 *
 * The Fuel Finder API returns codes that vary in form (`E10`, `E5`,
 * `B7 Standard`, `SDV`, …), so we match on a normalised, token-based key
 * rather than exact strings, then pick up to two headline fuels — preferring
 * the standard unleaded + diesel, but falling back gracefully for bespoke
 * stations (diesel-only HGV stops, LPG/HVO-only sites, single-fuel sites, …).
 */

export type FuelCategory = 'petrol' | 'diesel' | 'other'

type FuelMatch = {
	label: string
	category: FuelCategory
	/** Lower wins when filling a category's headline slot. */
	headlinePriority: number
	test: (normalised: string) => boolean
}

/** Uppercase, strip everything but letters/digits: `b7_standard` -> `B7STANDARD`. */
function normaliseCode(code: string): string {
	return code.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

// Order matters: more specific variants are checked before generic ones
// (e.g. E5 / super before plain unleaded; premium / B10 diesel before plain
// B7 diesel). Real Fuel Finder codes seen: E10, E5, B7_STANDARD, B7_PREMIUM,
// B10, HVO.
const FUEL_RULES: FuelMatch[] = [
	{
		label: 'Unleaded',
		category: 'petrol',
		headlinePriority: 0,
		test: (n) => n.includes('E10')
	},
	{
		label: 'Super Unleaded',
		category: 'petrol',
		headlinePriority: 1,
		test: (n) => n.includes('E5') || n.includes('SUPERUNLEADED')
	},
	{
		label: 'Premium Diesel',
		category: 'diesel',
		headlinePriority: 1,
		test: (n) =>
			n.includes('SDV') ||
			n.includes('SUPERDIESEL') ||
			n.includes('PREMIUMDIESEL') ||
			(n.includes('B7') && n.includes('PREMIUM')) ||
			(n.includes('DIESEL') && n.includes('PREMIUM'))
	},
	{
		label: 'Diesel (B10)',
		category: 'diesel',
		headlinePriority: 2,
		test: (n) => n.includes('B10')
	},
	{
		label: 'Diesel',
		category: 'diesel',
		headlinePriority: 0,
		test: (n) => n.includes('B7') || n.includes('DIESEL')
	},
	{
		label: 'Unleaded',
		category: 'petrol',
		headlinePriority: 0,
		test: (n) => n.includes('UNLEADED') || n.includes('PETROL')
	},
	{
		label: 'LPG',
		category: 'other',
		headlinePriority: 5,
		test: (n) => n.includes('LPG')
	},
	{
		label: 'HVO',
		category: 'other',
		headlinePriority: 5,
		test: (n) => n.includes('HVO')
	}
]

function matchFuel(code: string): FuelMatch | null {
	const normalised = normaliseCode(code)
	return FUEL_RULES.find((rule) => rule.test(normalised)) ?? null
}

/** Title-case an unrecognised code as a last-resort label. */
function titleCaseCode(code: string): string {
	const cleaned = code.replace(/[_-]+/g, ' ').trim()
	if (!cleaned) return code
	// Keep short codes (≤4 chars) uppercased; otherwise title-case words.
	if (cleaned.length <= 4 && !cleaned.includes(' ')) {
		return cleaned.toUpperCase()
	}
	return cleaned
		.toLowerCase()
		.split(' ')
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(' ')
}

export function fuelLabel(code: string): string {
	return matchFuel(code)?.label ?? titleCaseCode(code)
}

export function fuelCategory(code: string): FuelCategory {
	return matchFuel(code)?.category ?? 'other'
}

function headlinePriority(code: string): number {
	return matchFuel(code)?.headlinePriority ?? 9
}

export type FuelPrice = {
	code: string
	label: string
	category: FuelCategory
	pricePence: number | null
	timestamp: string | null
}

/**
 * Decorate a raw `{ code, pricePence, timestamp }` list with labels/categories,
 * ordered for the fuel switcher: petrol, then diesel, then other; within a
 * category by headline priority then label.
 */
export function decorateFuels(
	raw: { code: string; pricePence: number | null; timestamp: string | null }[]
): FuelPrice[] {
	const categoryRank: Record<FuelCategory, number> = {
		petrol: 0,
		diesel: 1,
		other: 2
	}
	return raw
		.map((fuel) => ({
			code: fuel.code,
			label: fuelLabel(fuel.code),
			category: fuelCategory(fuel.code),
			pricePence: fuel.pricePence,
			timestamp: fuel.timestamp
		}))
		.sort((a, b) => {
			if (categoryRank[a.category] !== categoryRank[b.category]) {
				return categoryRank[a.category] - categoryRank[b.category]
			}
			if (headlinePriority(a.code) !== headlinePriority(b.code)) {
				return headlinePriority(a.code) - headlinePriority(b.code)
			}
			return a.label.localeCompare(b.label)
		})
}

function pickForCategory(
	fuels: FuelPrice[],
	category: FuelCategory,
	used: Set<string>
): FuelPrice | null {
	const candidates = fuels
		.filter((fuel) => fuel.category === category && !used.has(fuel.code))
		// Prefer fuels that actually have a current price for the sign.
		.sort((a, b) => {
			const aHas = a.pricePence !== null ? 0 : 1
			const bHas = b.pricePence !== null ? 0 : 1
			if (aHas !== bHas) return aHas - bHas
			return headlinePriority(a.code) - headlinePriority(b.code)
		})
	return candidates[0] ?? null
}

/**
 * Choose up to two headline fuels for the forecourt sign.
 *
 *  - Petrol slot: E10 → E5 → any petrol.
 *  - Diesel slot: B7 → SDV → any diesel.
 *  - If a slot is empty (bespoke station), fill it from the remaining fuels so
 *    the sign always shows real numbers, labelled with their own name.
 *  - Single-fuel stations return a single headline.
 */
export function selectHeadlineFuels(fuels: FuelPrice[]): FuelPrice[] {
	if (fuels.length === 0) return []

	const used = new Set<string>()
	const headline: FuelPrice[] = []

	const petrol = pickForCategory(fuels, 'petrol', used)
	if (petrol) {
		headline.push(petrol)
		used.add(petrol.code)
	}
	const diesel = pickForCategory(fuels, 'diesel', used)
	if (diesel) {
		headline.push(diesel)
		used.add(diesel.code)
	}

	if (headline.length < 2) {
		const filler = fuels
			.filter((fuel) => !used.has(fuel.code))
			.sort((a, b) => {
				const aHas = a.pricePence !== null ? 0 : 1
				const bHas = b.pricePence !== null ? 0 : 1
				if (aHas !== bHas) return aHas - bHas
				return headlinePriority(a.code) - headlinePriority(b.code)
			})
		for (const fuel of filler) {
			if (headline.length >= 2) break
			headline.push(fuel)
			used.add(fuel.code)
		}
	}

	// Keep sign order stable: petrol-ish first.
	return headline.sort((a, b) => {
		const rank: Record<FuelCategory, number> = {
			petrol: 0,
			diesel: 1,
			other: 2
		}
		return rank[a.category] - rank[b.category]
	})
}

/** The fuel code the page should select by default for chart/comparisons. */
export function selectDefaultFuel(fuels: FuelPrice[]): string | null {
	const headline = selectHeadlineFuels(fuels)
	const withPrice = headline.find((fuel) => fuel.pricePence !== null)
	return withPrice?.code ?? headline[0]?.code ?? fuels[0]?.code ?? null
}
