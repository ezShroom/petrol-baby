/**
 * UK phone number formatting.
 *
 * Normalises phone numbers to international format with proper spacing:
 *   +44 20 XXXX XXXX     (London)
 *   +44 1X1 XXX XXXX     (3-digit area codes: 113, 114, 115, 116, 117, 118, 121, 131, etc.)
 *   +44 1XXX XXXXXX      (4-digit area codes)
 *   +44 1XXXX XXXXX      (5-digit area codes)
 *   +44 2X XXXX XXXX     (2X area codes: 23, 24, 28, 29)
 *   +44 3XX XXX XXXX     (non-geographic)
 *   +44 7XXX XXXXXX      (mobile)
 *   +44 800 XXX XXXX     (freephone)
 *   +44 8XX XXX XXXX     (other 8xx)
 *   +44 9XX XXX XXXX     (premium)
 *
 * Returns null for null input.
 * Returns the original string unchanged if the number can't be parsed.
 */

/**
 * 2+8 area codes: London (20) and other 2X codes.
 * Format: +44 2X XXXX XXXX
 */
const TWO_DIGIT_AREAS = new Set(['20', '23', '24', '28', '29'])

/**
 * 3+7 area codes (1X1 pattern).
 * Format: +44 1X1 XXX XXXX
 */
const THREE_DIGIT_AREAS = new Set([
	'113',
	'114',
	'115',
	'116',
	'117',
	'118',
	'121',
	'131',
	'141',
	'151',
	'161',
	'171',
	'181',
	'191'
])

/**
 * 5+5/5+4 area codes (small towns with 5-digit area codes).
 * These start with 01XXXX where the full local number is 5 or 4 digits.
 * Format: +44 1XXXX XXXXX or +44 1XXXX XXXX
 *
 * A non-exhaustive list of 5-digit area codes. We include the most
 * common ones; numbers not matching these fall through to 4-digit.
 */
const FIVE_DIGIT_AREA_PREFIXES = new Set([
	'13873', // Langholm
	'15242', // Hornby
	'15394', // Hawkshead
	'15395', // Grange-over-Sands
	'15396', // Sedbergh
	'16973', // Wigton
	'16974', // Raughton Head
	'16977', // Brampton
	'17683', // Appleby
	'17684', // Pooley Bridge
	'17687', // Keswick
	'19467' //  Wasdale
])

/**
 * Strips a raw phone string down to just the digits, handling:
 *   - Leading +44
 *   - Leading 0044
 *   - (0) hints
 *   - Various separators (spaces, dashes, dots, parens)
 *
 * Returns the national number digits (without leading 0) or null if
 * the input can't be parsed as a UK number.
 */
function toNationalDigits(raw: string): string | null {
	// Remove (0) hint pattern before stripping separators
	let cleaned = raw.replace(/\(0\)/g, '')

	// Remove all whitespace and common separators
	cleaned = cleaned.replace(/[\s\-.()]/g, '')

	// Handle +44 prefix
	if (cleaned.startsWith('+44')) {
		cleaned = cleaned.slice(3)
	}
	// Handle 0044 prefix
	else if (cleaned.startsWith('0044')) {
		cleaned = cleaned.slice(4)
	}
	// Handle leading 0 (national format)
	else if (cleaned.startsWith('0')) {
		cleaned = cleaned.slice(1)
	}
	// Doesn't look like a UK number
	else {
		return null
	}

	// Strip any remaining non-digit characters
	cleaned = cleaned.replace(/\D/g, '')

	// UK national numbers are 10 digits (after removing the leading 0/+44)
	if (cleaned.length !== 10) return null

	return cleaned
}

/**
 * Formats a 10-digit national number (no leading 0, no +44) with
 * appropriate spacing based on the area code type.
 */
function formatNational(digits: string): string {
	// Mobile: 7XXX XXXXXX
	if (digits.startsWith('7')) {
		return `+44 ${digits.slice(0, 4)} ${digits.slice(4)}`
	}

	// 2X area codes: 2X XXXX XXXX
	const twoDigit = digits.slice(0, 2)
	if (TWO_DIGIT_AREAS.has(twoDigit)) {
		return `+44 ${digits.slice(0, 2)} ${digits.slice(2, 6)} ${digits.slice(6)}`
	}

	// 1XX area codes
	if (digits.startsWith('1')) {
		// Check for 5-digit area codes first
		const fiveDigit = digits.slice(0, 5)
		if (FIVE_DIGIT_AREA_PREFIXES.has(fiveDigit)) {
			return `+44 ${digits.slice(0, 5)} ${digits.slice(5)}`
		}

		// Check for 3-digit area codes (1X1 pattern)
		const threeDigit = digits.slice(0, 3)
		if (THREE_DIGIT_AREAS.has(threeDigit)) {
			return `+44 ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`
		}

		// Default to 4-digit area code: 1XXX XXXXXX
		return `+44 ${digits.slice(0, 4)} ${digits.slice(4)}`
	}

	// 3XX non-geographic: 3XX XXX XXXX
	if (digits.startsWith('3')) {
		return `+44 ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`
	}

	// 800 freephone: 800 XXX XXXX
	if (digits.startsWith('800')) {
		return `+44 ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`
	}

	// Other 8XX: 8XX XXX XXXX
	if (digits.startsWith('8')) {
		return `+44 ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`
	}

	// 9XX premium: 9XX XXX XXXX
	if (digits.startsWith('9')) {
		return `+44 ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`
	}

	// Fallback: just space after +44 and return as-is
	return `+44 ${digits}`
}

/**
 * Formats a phone number into UK international format with proper spacing.
 *
 * Returns null for null input.
 * Returns the original string unchanged if it can't be parsed as a UK number.
 */
export function formatPhoneNumber(phone: string | null): string | null {
	if (phone === null) return null

	const trimmed = phone.trim()
	if (trimmed === '') return null

	const digits = toNationalDigits(trimmed)
	if (digits === null) return phone // Return unchanged if unparseable

	return formatNational(digits)
}
