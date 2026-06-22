import { OpenRouter } from '@openrouter/sdk'
import { ms } from 'ms'

/**
 * A cheap, free model is plenty for turning an amenity code into a label. We
 * only ever call this once per distinct code (the result is cached in the DB
 * forever), so quality matters more than speed and cost is negligible.
 */
const AMENITY_NAMING_MODEL = 'google/gemma-4-31b-it:free'
const AMENITY_NAMING_TIMEOUT_MS = ms('30s')

const SYSTEM_PROMPT = `You convert fuel-station amenity codes into short, human-friendly labels in Title Case.
Reply with ONLY the label — no quotes, no punctuation, no explanation, no trailing text.
Keep it concise (1-4 words). Expand obvious abbreviations and use correct, conventional casing for brands and initialisms (e.g. AdBlue not Adblue, HGV not Hgv, ATM, EV, LPG, HVO, Wi-Fi, CCTV, WC).
Examples:
adblue_packaged -> AdBlue Packaged
adblue_pump -> AdBlue Pump
customer_toilets -> Customer Toilets
hgv_lane -> HGV Lane
atm -> ATM
ev_charging -> EV Charging
wifi -> Wi-Fi
lpg -> LPG`

/**
 * Canonical casing for initialisms / brands that simple Title Case mangles.
 * Applied to both LLM output and the deterministic fallback so amenities read
 * consistently (`adblue` -> `AdBlue`, `hgv` -> `HGV`, …).
 */
const CASING_FIXUPS: Record<string, string> = {
	adblue: 'AdBlue',
	hgv: 'HGV',
	atm: 'ATM',
	ev: 'EV',
	lpg: 'LPG',
	hvo: 'HVO',
	cctv: 'CCTV',
	wifi: 'Wi-Fi',
	wc: 'WC',
	anpr: 'ANPR',
	uk: 'UK',
	usb: 'USB',
	tv: 'TV'
}

function applyCasingFixups(label: string): string {
	return label.replace(/[A-Za-z]+/g, (word) => CASING_FIXUPS[word.toLowerCase()] ?? word)
}

/**
 * Deterministic fallback used when the LLM is unavailable or returns junk:
 * `adblue_packaged` -> `AdBlue Packaged`. Decent on its own; the LLM mainly
 * improves casing of less common brands/initialisms.
 */
export function prettifyAmenityCode(code: string): string {
	const cleaned = code.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
	if (!cleaned) return code
	const titled = cleaned
		.split(' ')
		.map((word) =>
			word ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : word
		)
		.join(' ')
	return applyCasingFixups(titled)
}

function sanitiseLabel(raw: string | null | undefined): string | null {
	if (!raw) return null
	const firstLine = raw.split('\n')[0] ?? ''
	const cleaned = firstLine
		.trim()
		.replace(/^["'`]+|["'`]+$/g, '')
		.replace(/[.;:]+$/g, '')
		.replace(/\s+/g, ' ')
		.trim()
	if (!cleaned || cleaned.length > 60) return null
	return cleaned
}

export class AmenityNamer {
	private client

	constructor({ env }: { env: Env }) {
		this.client = new OpenRouter({ apiKey: env.OPENROUTER_API_KEY })
	}

	/**
	 * Produce a friendly label for a single amenity code. Always resolves to a
	 * usable string — falls back to {@link prettifyAmenityCode} on any error or
	 * unusable response, so callers can cache the result unconditionally.
	 */
	async nameOne(code: string): Promise<string> {
		try {
			const response = await this.client.chat.send(
				{
					httpReferer: 'https://petrol.baby/',
					appTitle: 'petrol.baby',
					chatRequest: {
						model: AMENITY_NAMING_MODEL,
						messages: [
							{ role: 'system', content: SYSTEM_PROMPT },
							{ role: 'user', content: code }
						]
					}
				},
				{ timeoutMs: AMENITY_NAMING_TIMEOUT_MS }
			)
			const label = sanitiseLabel(response.choices[0]?.message.content)
			return label ?? prettifyAmenityCode(code)
		} catch (error) {
			console.warn(`Amenity naming failed for "${code}":`, error)
			return prettifyAmenityCode(code)
		}
	}
}
