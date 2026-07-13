import type {
	CompareData,
	SitemapResult,
	SlugResolution,
	StationListResult
} from '@petrol-baby/server'
import { getService } from './service'

// Thin wrappers so route files don't touch the service class directly. The
// old Cloudflare service-binding hop (and its JSON-string round trip) is
// gone: these are plain in-process calls against the shared SQLite database.

export async function fetchStationPage(slug: string): Promise<SlugResolution> {
	return getService().getStationPage(slug)
}

export async function fetchStationCompare(
	nodeId: string,
	fuelType: string
): Promise<CompareData | null> {
	return getService().getStationCompare(nodeId, fuelType)
}

export async function fetchStations(options: {
	cursor: string | null
	query: string | null
}): Promise<StationListResult> {
	return getService().listStationsPage(options)
}

export async function fetchSitemapSlugs(
	cursor: string | null
): Promise<SitemapResult> {
	return getService().listSitemapSlugs(cursor)
}
