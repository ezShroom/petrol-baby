/** Shared display formatting helpers for the public station pages. */

/** Format a price in pence as e.g. `188.9` (one decimal, no trailing unit). */
export function formatPence(pricePence: number | null | undefined): string | null {
	if (pricePence === null || pricePence === undefined) return null
	return (Math.round(pricePence * 10) / 10).toFixed(1)
}

/** Format a price in pence as `188.9p`. */
export function formatPenceUnit(
	pricePence: number | null | undefined
): string {
	const value = formatPence(pricePence)
	return value === null ? '—' : `${value}p`
}

/** Format a straight-line distance in km. */
export function formatDistance(distanceKm: number | null | undefined): string {
	if (distanceKm === null || distanceKm === undefined) return ''
	if (distanceKm < 1) return `${Math.round(distanceKm * 1000)} m`
	return `${distanceKm.toFixed(1)} km`
}

/** Human "updated 3 minutes ago"-style relative time from an ISO string. */
export function relativeTime(iso: string | null | undefined): string | null {
	if (!iso) return null
	const then = new Date(iso).getTime()
	if (Number.isNaN(then)) return null
	const diffMs = Date.now() - then
	const minutes = Math.round(diffMs / 60000)
	if (minutes < 1) return 'just now'
	if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
	const hours = Math.round(minutes / 60)
	if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
	const days = Math.round(hours / 24)
	return `${days} day${days === 1 ? '' : 's'} ago`
}

/** Compose a one-line address from station fields. */
export function formatAddress(station: {
	address1?: string | null
	address2?: string | null
	city?: string | null
	postcode?: string | null
}): string {
	return [station.address1, station.address2, station.city, station.postcode]
		.map((part) => part?.trim())
		.filter((part): part is string => Boolean(part))
		.join(', ')
}

const DAY_LABELS = [
	'Monday',
	'Tuesday',
	'Wednesday',
	'Thursday',
	'Friday',
	'Saturday',
	'Sunday',
	'Bank holidays'
]

export function openingDayLabel(day: number): string {
	return DAY_LABELS[day] ?? `Day ${day}`
}

/** Format a "HH:MM" opening time, tolerating already-formatted strings. */
export function formatOpeningRow(time: {
	openTime: string
	closeTime: string
	is24Hours: boolean
}): string {
	if (time.is24Hours) return 'Open 24 hours'
	if (!time.openTime && !time.closeTime) return 'Closed'
	return `${time.openTime} – ${time.closeTime}`
}
