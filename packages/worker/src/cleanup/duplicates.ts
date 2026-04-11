/**
 * Deterministic duplicate detection for fuel stations.
 *
 * Uses Haversine distance, normalised address similarity, and brand
 * matching to identify potential duplicate entries.
 */

const EARTH_RADIUS_M = 6_371_000

/**
 * Haversine distance in metres between two lat/lon pairs.
 */
function haversineDistance(
	lat1: number,
	lon1: number,
	lat2: number,
	lon2: number
): number {
	const toRad = (deg: number) => (deg * Math.PI) / 180
	const dLat = toRad(lat2 - lat1)
	const dLon = toRad(lon2 - lon1)
	const a =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
	return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/**
 * Simple normalisation for address comparison: lowercase, strip
 * punctuation and excess whitespace.
 */
function normaliseAddress(s: string | null): string {
	if (!s) return ''
	return s
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, '')
		.replace(/\s+/g, ' ')
		.trim()
}

/**
 * Simple normalisation for brand comparison.
 */
function normaliseBrand(s: string | null): string {
	if (!s) return ''
	return s.toLowerCase().trim()
}

export type DuplicateCandidate = {
	nodeId: string
	latitude: number
	longitude: number
	address1: string | null
	postcode: string | null
	brandName: string | null
}

/** Maximum distance in metres to consider stations as potential duplicates */
const DISTANCE_THRESHOLD_M = 100

export function arePotentialDuplicates(
	a: DuplicateCandidate,
	b: DuplicateCandidate
): boolean {
	if (a.nodeId === b.nodeId) {
		return false
	}

	if (normaliseBrand(a.brandName) !== normaliseBrand(b.brandName)) {
		return false
	}
	if (!a.brandName || !b.brandName) return false

	const distance = haversineDistance(
		a.latitude,
		a.longitude,
		b.latitude,
		b.longitude
	)
	if (distance > DISTANCE_THRESHOLD_M) return false

	const samePostcode =
		a.postcode &&
		b.postcode &&
		a.postcode.replace(/\s/g, '').toUpperCase() ===
			b.postcode.replace(/\s/g, '').toUpperCase()

	const similarAddress =
		normaliseAddress(a.address1) !== '' &&
		normaliseAddress(a.address1) === normaliseAddress(b.address1)

	return Boolean(samePostcode || similarAddress)
}

export function detectDuplicatesForTargets(
	targets: DuplicateCandidate[],
	candidates: DuplicateCandidate[]
): Map<string, string[]> {
	const duplicates = new Map<string, string[]>()

	for (const target of targets) {
		for (const candidate of candidates) {
			if (!arePotentialDuplicates(target, candidate)) {
				continue
			}

			const existing = duplicates.get(target.nodeId)
			if (existing) {
				existing.push(candidate.nodeId)
			} else {
				duplicates.set(target.nodeId, [candidate.nodeId])
			}
		}
	}

	return duplicates
}

/**
 * Detects potential duplicate stations.
 *
 * Two stations are flagged as potential duplicates when ALL of:
 *   1. They are within 100m of each other (Haversine distance)
 *   2. They share the same brand (normalised)
 *   3. They have the same postcode OR very similar address line 1
 *
 * Returns a Map of nodeId -> array of potential duplicate nodeIds.
 * Both sides of each pair are populated (i.e. if A is a duplicate of B,
 * both A->B and B->A appear in the map).
 */
export function detectDuplicates(
	stations: DuplicateCandidate[]
): Map<string, string[]> {
	const duplicates = new Map<string, string[]>()

	for (let i = 0; i < stations.length; i++) {
		const a = stations[i]
		if (!a) continue
		for (let j = i + 1; j < stations.length; j++) {
			const b = stations[j]
			if (!b) continue

			if (!arePotentialDuplicates(a, b)) continue

			// It's a duplicate pair
			if (!duplicates.has(a.nodeId)) duplicates.set(a.nodeId, [])
			if (!duplicates.has(b.nodeId)) duplicates.set(b.nodeId, [])
			duplicates.get(a.nodeId)?.push(b.nodeId)
			duplicates.get(b.nodeId)?.push(a.nodeId)
		}
	}

	return duplicates
}
