import { fetchSitemapSlugs } from '$lib/server/backend'
import type { RequestHandler } from './$types'

const SITE = 'https://petrol.baby'
const MAX_PAGES = 60

function escapeXml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;')
}

export const GET: RequestHandler = async ({ setHeaders }) => {
	const urls: string[] = [
		`<url><loc>${SITE}/</loc><changefreq>daily</changefreq></url>`,
		`<url><loc>${SITE}/stations</loc><changefreq>daily</changefreq></url>`
	]

	let cursor: string | null = null
	for (let page = 0; page < MAX_PAGES; page++) {
		const result = await fetchSitemapSlugs(cursor)
		for (const entry of result.items) {
			if (!entry.slug) continue
			const loc = `${SITE}/station/${escapeXml(entry.slug)}`
			const lastmod = entry.lastmod ? `<lastmod>${entry.lastmod}</lastmod>` : ''
			urls.push(
				`<url><loc>${loc}</loc>${lastmod}<changefreq>daily</changefreq></url>`
			)
		}
		if (!result.nextCursor) break
		cursor = result.nextCursor
	}

	const body =
		`<?xml version="1.0" encoding="UTF-8"?>` +
		`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` +
		urls.join('') +
		`</urlset>`

	setHeaders({
		'content-type': 'application/xml; charset=utf-8',
		'cache-control': 'public, max-age=3600, s-maxage=21600'
	})

	return new Response(body)
}
