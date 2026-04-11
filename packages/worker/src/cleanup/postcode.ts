/**
 * UK postcode validation and formatting.
 *
 * Covers all six valid UK postcode formats per BS 7666 with
 * positional character restrictions:
 *
 *   Format      Example
 *   A9 9AA      M1 1AE
 *   A99 9AA     B33 8TH
 *   A9A 9AA     W1A 0AX
 *   AA9 9AA     CR2 6XH
 *   AA99 9AA    DN55 1PT
 *   AA9A 9AA    EC1A 1BB
 *
 * Character restrictions:
 *   Position 1: A-P, R-U, W, Y, Z (no Q, V, X)
 *   Position 2 (letter): A-H, K-Y (no I, J, Z)
 *   Position 3/4 (letter in outcode): A, B, C, D, E, F, G, H, J, K, P, S, T, U, W
 *   Incode unit letters: A, B, D-H, J, L, N, P-U, W-Z (no C, I, K, M, O, V)
 */

/**
 * Full UK postcode regex with BS 7666 positional character restrictions.
 * Matches all six valid formats with flexible spacing.
 */
export const POSTCODE_REGEX =
	/^[A-PR-UWYZ][A-HK-Y]?\d[A-HJKPSTUW\d]?\s*\d[ABD-HJLNP-UW-Z]{2}$/i

/**
 * Outcode-only regex (for cases where only the outcode is provided,
 * e.g. when a full postcode was deemed implausible and replaced with
 * just the outcode).
 */
export const OUTCODE_REGEX = /^[A-PR-UWYZ][A-HK-Y]?\d[A-HJKPSTUW\d]?$/i

export function isValidPostcode(s: string): boolean {
	return POSTCODE_REGEX.test(s.trim())
}

export function isValidOutcode(s: string): boolean {
	return OUTCODE_REGEX.test(s.trim())
}

/**
 * Formats a postcode string:
 *  - Strips to alphanumeric characters
 *  - Uppercases
 *  - Inserts space before the 3-character incode
 *  - Validates against the full postcode regex
 *
 * Returns the formatted postcode, or null if it doesn't validate.
 */
export function formatPostcode(s: string): string | null {
	// Strip to alphanumeric only
	const stripped = s.replace(/[^A-Za-z0-9]/g, '').toUpperCase()

	if (stripped.length < 5 || stripped.length > 7) return null

	// Insert space before last 3 characters (the incode)
	const outcode = stripped.slice(0, -3)
	const incode = stripped.slice(-3)
	const formatted = `${outcode} ${incode}`

	if (!POSTCODE_REGEX.test(formatted)) return null

	return formatted
}

/**
 * Extracts the outcode (area + district) from a postcode string.
 * Works on both full postcodes and outcode-only strings.
 */
export function extractOutcode(s: string): string | null {
	const trimmed = s.trim().toUpperCase()

	// Try as full postcode first
	if (POSTCODE_REGEX.test(trimmed.replace(/\s+/g, ' '))) {
		const stripped = trimmed.replace(/[^A-Za-z0-9]/g, '')
		return stripped.slice(0, -3)
	}

	// Try as outcode-only
	const stripped = trimmed.replace(/[^A-Za-z0-9]/g, '')
	if (OUTCODE_REGEX.test(stripped)) {
		return stripped
	}

	return null
}

/**
 * Extracts the postcode area (the leading letters) from a postcode or outcode.
 */
export function extractArea(s: string): string | null {
	const outcode = extractOutcode(s)
	if (!outcode) return null
	const match = outcode.match(/^[A-Z]{1,2}/i)
	return match ? match[0].toUpperCase() : null
}
