/**
 * UK bounding box coordinate validation and fixing.
 *
 * The UK (including Northern Ireland) fits within:
 *   Latitude:  49.9 - 60.9
 *   Longitude: -8.2 - 1.8
 *
 * We allow the permitted transformations from the original prompt:
 *   1. Swapping latitude and longitude
 *   2. Flipping the sign on either value
 */

const UK_LAT_MIN = 49.9
const UK_LAT_MAX = 60.9
const UK_LON_MIN = -8.2
const UK_LON_MAX = 1.8

export function isInUK(lat: number, lon: number): boolean {
	return (
		lat >= UK_LAT_MIN &&
		lat <= UK_LAT_MAX &&
		lon >= UK_LON_MIN &&
		lon <= UK_LON_MAX
	)
}

export type CoordinateFixResult = {
	latitude: number
	longitude: number
	/** Whether the coordinates were modified from the original */
	fixed: boolean
	/** Whether the coordinates are known to be inside the UK after fixing */
	valid: boolean
}

/**
 * Attempts to fix coordinates that fall outside the UK bounding box.
 *
 * Tries the following transformations in order, returning the first
 * that places the coordinates inside the UK:
 *   1. Already valid (no change)
 *   2. Swap lat/lon
 *   3. Flip sign on latitude
 *   4. Flip sign on longitude
 *   5. Flip sign on both
 *   6. Swap + flip sign on latitude
 *   7. Swap + flip sign on longitude
 *   8. Swap + flip both signs
 *
 * Returns the original coordinates with valid=false if none work.
 */
export function fixCoordinates(
	latitude: number,
	longitude: number
): CoordinateFixResult {
	// Already valid
	if (isInUK(latitude, longitude)) {
		return { latitude, longitude, fixed: false, valid: true }
	}

	// Each candidate is [lat, lon]
	const candidates: [number, number][] = [
		[longitude, latitude], // swap
		[-latitude, longitude], // flip lat sign
		[latitude, -longitude], // flip lon sign
		[-latitude, -longitude], // flip both signs
		[-longitude, latitude], // swap + flip lat (was lon)
		[longitude, -latitude], // swap + flip lon (was lat)
		[-longitude, -latitude] // swap + flip both
	]

	for (const [lat, lon] of candidates) {
		if (isInUK(lat, lon)) {
			return { latitude: lat, longitude: lon, fixed: true, valid: true }
		}
	}

	// Nothing worked -- return original, flagged as invalid
	return { latitude, longitude, fixed: false, valid: false }
}
