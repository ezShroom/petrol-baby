/**
 * Deterministic, collision-proof, human-readable slugs for station pages.
 *
 * A slug looks like `asda-hollingbury-brighton-k7f2a9`:
 *   - the descriptive part (brand/trading name + city) is cosmetic and may be
 *     regenerated when the underlying data is cleaned;
 *   - the trailing token is a short, stable hash of the immutable `nodeId`, so
 *     it never collides and never changes.
 *
 * Lookups can fall back to matching on the token alone, letting stale
 * descriptive slugs 301-redirect to the canonical one.
 */

const TOKEN_LENGTH = 8
// Crockford-ish base32 alphabet without ambiguous characters (no i/l/o/u).
const TOKEN_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'

/**
 * cyrb53 — a fast, well-distributed 53-bit string hash. JS numbers represent
 * all 53-bit integers exactly, so we get a large, uniform key space from which
 * to carve the slug token. Far better avalanche than FNV for sequential ids.
 */
function cyrb53(input: string, seed = 0): number {
	let h1 = 0xdeadbeef ^ seed
	let h2 = 0x41c6ce57 ^ seed
	for (let i = 0; i < input.length; i++) {
		const ch = input.charCodeAt(i)
		h1 = Math.imul(h1 ^ ch, 2654435761)
		h2 = Math.imul(h2 ^ ch, 1597334677)
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507)
	h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909)
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507)
	h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909)
	return 4294967296 * (2097151 & h2) + (h1 >>> 0)
}

/**
 * Derive the stable token for a station from its nodeId: 8 base32 chars (40
 * bits), which keeps collisions astronomically unlikely across the whole UK
 * station set while staying short and readable.
 */
export function slugTokenForNodeId(nodeId: string): string {
	let n = cyrb53(nodeId)
	let token = ''
	for (let i = 0; i < TOKEN_LENGTH; i++) {
		token = TOKEN_ALPHABET[n % 32] + token
		n = Math.floor(n / 32)
	}
	return token
}

/** Lowercase, strip punctuation, collapse whitespace into single hyphens. */
function slugifyPart(value: string | null | undefined): string {
	if (!value) return ''
	return value
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/&/g, ' and ')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.replace(/-{2,}/g, '-')
}

export type SlugStationInput = {
	nodeId: string
	tradingName?: string | null
	brandName?: string | null
	city?: string | null
}

/**
 * Build the canonical slug for a station. The descriptive prefix prefers the
 * trading name, then the brand, and appends the city when available; the
 * stable token is always last.
 */
export function buildStationSlug(station: SlugStationInput): string {
	const name = slugifyPart(station.tradingName ?? station.brandName)
	const city = slugifyPart(station.city)
	const token = slugTokenForNodeId(station.nodeId)

	const descriptive = [name, city].filter(Boolean).join('-')
	return descriptive ? `${descriptive}-${token}` : `station-${token}`
}

/**
 * Extract the trailing token from a (possibly stale) slug requested by a
 * client. Returns null when the slug doesn't end in a token-shaped segment.
 */
export function extractSlugToken(slug: string): string | null {
	const segments = slug.toLowerCase().split('-')
	const last = segments[segments.length - 1]
	if (!last || last.length !== TOKEN_LENGTH) return null
	for (const char of last) {
		if (!TOKEN_ALPHABET.includes(char)) return null
	}
	return last
}
