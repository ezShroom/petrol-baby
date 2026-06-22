<script lang="ts">
	import { resolve } from '$app/paths'
	import Footer from '$lib/components/Footer.svelte'
	import PokeCta from '$lib/components/PokeCta.svelte'
	import StationExplorer from '$lib/components/StationExplorer.svelte'
	import {
		formatAddress,
		formatOpeningRow,
		formatPence,
		formatPenceUnit,
		openingDayLabel,
		relativeTime
	} from '$lib/format'
	import ogImage from '$lib/assets/opengraph.png'
	import type { PageData } from './$types'

	const SITE = 'https://petrol.baby'

	let { data }: { data: PageData } = $props()
	const payload = $derived(data.payload)
	const station = $derived(payload.station)

	// ─── Live prices over the websocket ──────────────────────────────────
	type LiveUpdate = { fuelType: string; pricePence: number; timestamp: string }
	let liveOverrides = $state<Record<string, number>>({})
	let explorerRef = $state<{ applyLivePrice: (u: LiveUpdate) => void }>()

	function headlinePrice(code: string, fallback: number | null): number | null {
		return liveOverrides[code] ?? fallback
	}

	$effect(() => {
		const nodeId = station.nodeId
		liveOverrides = {}
		let socket: WebSocket | null = null
		let closed = false
		let retry: ReturnType<typeof setTimeout> | undefined

		const connect = () => {
			const proto = location.protocol === 'https:' ? 'wss' : 'ws'
			socket = new WebSocket(
				`${proto}://${location.host}/live?station=${encodeURIComponent(nodeId)}`
			)
			socket.addEventListener('message', (event) => {
				try {
					const msg = JSON.parse(event.data) as LiveUpdate & { type: string }
					if (msg.type !== 'price') return
					liveOverrides = { ...liveOverrides, [msg.fuelType]: msg.pricePence }
					explorerRef?.applyLivePrice(msg)
				} catch {
					/* ignore malformed frames */
				}
			})
			socket.addEventListener('close', () => {
				if (!closed) retry = setTimeout(connect, 5000)
			})
			socket.addEventListener('error', () => socket?.close())
		}
		connect()

		return () => {
			closed = true
			clearTimeout(retry)
			socket?.close()
		}
	})

	// ─── Display derivations ─────────────────────────────────────────────
	const canonical = $derived(`${SITE}/station/${station.slug}`)
	const updatedAgo = $derived(relativeTime(payload.lastUpdated))
	const isClosed = $derived(Boolean(station.permanentClosureDate))
	const headlineSummary = $derived(
		payload.headline
			.filter((f) => f.pricePence !== null)
			.map((f) => `${f.label} ${formatPenceUnit(f.pricePence)}`)
			.join(', ')
	)
	const cityLine = $derived(
		[station.city, station.postcode].filter(Boolean).join(' ')
	)

	const pageTitle = $derived(
		headlineSummary
			? `${station.displayName} fuel prices — ${headlineSummary} | petrol.baby`
			: `${station.displayName} fuel prices${station.city ? ` in ${station.city}` : ''} | petrol.baby`
	)
	const pageDescription = $derived(
		`Live fuel prices at ${station.displayName}${station.city ? `, ${station.city}` : ''}.` +
			` See the 14-day price history, the nearest stations and the cheapest fuel${station.city ? ` in ${station.city}` : ''}.` +
			(updatedAgo ? ` Updated ${updatedAgo}.` : '')
	)

	// ─── Structured data ─────────────────────────────────────────────────
	const SCHEMA_DAYS = [
		'Monday',
		'Tuesday',
		'Wednesday',
		'Thursday',
		'Friday',
		'Saturday',
		'Sunday'
	]

	const jsonLd = $derived.by(() => {
		const node: Record<string, unknown> = {
			'@context': 'https://schema.org',
			'@type': 'GasStation',
			'@id': canonical,
			name: station.displayName,
			url: canonical
		}
		if (station.brandName) {
			node.brand = { '@type': 'Brand', name: station.brandName }
		}
		const address: Record<string, string> = { '@type': 'PostalAddress' }
		const street = [station.address1, station.address2]
			.filter(Boolean)
			.join(', ')
		if (street) address.streetAddress = street
		if (station.city) address.addressLocality = station.city
		if (station.postcode) address.postalCode = station.postcode
		if (station.country) address.addressCountry = station.country
		if (Object.keys(address).length > 1) node.address = address
		if (station.latitude !== null && station.longitude !== null) {
			node.geo = {
				'@type': 'GeoCoordinates',
				latitude: station.latitude,
				longitude: station.longitude
			}
		}
		const offers = payload.fuels
			.filter((fuel) => fuel.pricePence !== null)
			.map((fuel) => ({
				'@type': 'Offer',
				itemOffered: { '@type': 'Product', name: fuel.label },
				priceSpecification: {
					'@type': 'UnitPriceSpecification',
					price: ((fuel.pricePence as number) / 100).toFixed(3),
					priceCurrency: 'GBP',
					unitCode: 'LTR'
				},
				...(fuel.timestamp ? { validFrom: fuel.timestamp } : {})
			}))
		if (offers.length > 0) node.makesOffer = offers
		const hours = payload.openingTimes
			.filter((time) => time.day >= 0 && time.day <= 6)
			.map((time) => ({
				'@type': 'OpeningHoursSpecification',
				dayOfWeek: `https://schema.org/${SCHEMA_DAYS[time.day]}`,
				...(time.is24Hours
					? { opens: '00:00', closes: '23:59' }
					: { opens: time.openTime, closes: time.closeTime })
			}))
		if (hours.length > 0) node.openingHoursSpecification = hours
		if (payload.lastUpdated) node.dateModified = payload.lastUpdated
		return node
	})

	const breadcrumbLd = $derived({
		'@context': 'https://schema.org',
		'@type': 'BreadcrumbList',
		itemListElement: [
			{ '@type': 'ListItem', position: 1, name: 'petrol.baby', item: SITE },
			{
				'@type': 'ListItem',
				position: 2,
				name: 'Stations',
				item: `${SITE}/stations`
			},
			{
				'@type': 'ListItem',
				position: 3,
				name: station.displayName,
				item: canonical
			}
		]
	})

	// Build the JSON-LD <script> markup. Split the closing tag so it neither
	// terminates this component's <script> block nor needs an escape eslint
	// flags, and escape `<` in the payload so station data can't break out.
	// Rendered in the body (valid for crawlers) rather than <svelte:head>,
	// where {@html} of a <script> corrupts Svelte 5 hydration.
	const CLOSE = '</scr' + 'ipt>'
	function ldScript(obj: unknown): string {
		const json = JSON.stringify(obj).replace(/</g, '\\u003c')
		return `<script type="application/ld+json">${json}${CLOSE}`
	}
	const structuredData = $derived(ldScript(jsonLd) + ldScript(breadcrumbLd))
</script>

<svelte:head>
	<title>{pageTitle}</title>
	<meta name="description" content={pageDescription} />
	<link rel="canonical" href={canonical} />
	{#if isClosed}
		<meta name="robots" content="noindex, follow" />
	{/if}
	<meta property="og:title" content={pageTitle} />
	<meta property="og:description" content={pageDescription} />
	<meta property="og:url" content={canonical} />
	<meta property="og:type" content="website" />
	<meta property="og:image" content="{SITE}{ogImage}" />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content={pageTitle} />
	<meta name="twitter:description" content={pageDescription} />
	<meta name="twitter:image" content="{SITE}{ogImage}" />
</svelte:head>

<div class="font-body bg-bg text-text-body flex min-h-dvh flex-col">
	<main class="mx-auto w-full max-w-3xl flex-1 px-6 py-10 sm:px-8 sm:py-14">
		<a
			href={resolve('/stations')}
			class="text-text-muted hover:text-text-link text-sm transition-colors"
			>&larr; all stations</a
		>

		<!-- Header -->
		<header class="mt-6">
			<div class="flex flex-wrap items-center gap-2">
				{#if station.brandName && station.brandName !== station.displayName}
					<span
						class="bg-surface-raised text-text-muted border-border rounded-full border px-2.5 py-0.5 text-xs"
						>{station.brandName}</span
					>
				{/if}
				{#if station.isMotorwayService}
					<span
						class="bg-surface-raised text-text-muted border-border rounded-full border px-2.5 py-0.5 text-xs"
						>Motorway services</span
					>
				{/if}
				{#if station.isSupermarketService}
					<span
						class="bg-surface-raised text-text-muted border-border rounded-full border px-2.5 py-0.5 text-xs"
						>Supermarket</span
					>
				{/if}
				{#if isClosed}
					<span
						class="rounded-full border border-red-500/40 bg-red-500/10 px-2.5 py-0.5 text-xs text-red-300"
						>Permanently closed</span
					>
				{/if}
			</div>
			<h1
				class="font-display text-text-heading mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl"
			>
				{station.displayName}
			</h1>
			{#if formatAddress(station)}
				<p class="text-text-body mt-2 text-base">{formatAddress(station)}</p>
			{/if}
			{#if updatedAgo}
				<p class="text-text-muted mt-1 text-sm">
					<span class="text-accent">●</span> Prices updated {updatedAgo}
				</p>
			{/if}
		</header>

		<!-- Forecourt sign -->
		{#if payload.headline.length > 0}
			<section class="mt-8" aria-label="Current headline prices">
				<div class="totem grid gap-3 sm:grid-cols-2">
					{#each payload.headline as fuel (fuel.code)}
						{@const price = headlinePrice(fuel.code, fuel.pricePence)}
						<div class="totem-row" class:diesel={fuel.category === 'diesel'}>
							<span class="totem-label">{fuel.label}</span>
							<span class="totem-price">
								{#if price !== null}
									{formatPence(price)}<span class="totem-unit">p</span>
								{:else}
									<span class="totem-unit">no data</span>
								{/if}
							</span>
						</div>
					{/each}
				</div>
			</section>
		{/if}

		<!-- Poke upsell — right under the prices -->
		<section class="mt-6">
			<PokeCta stationName={station.displayName} />
		</section>

		{#if payload.fuels.length > 0 && payload.defaultFuel}
			<section class="mt-10">
				{#key station.nodeId}
					<StationExplorer
						bind:this={explorerRef}
						nodeId={station.nodeId}
						slug={station.slug}
						fuels={payload.fuels}
						defaultFuel={payload.defaultFuel}
						initialCompare={payload.compare}
					/>
				{/key}
			</section>
		{:else}
			<p class="text-text-muted mt-8 text-sm">
				We don't have current price data for this station yet.
			</p>
		{/if}

		<!-- Details: opening hours + amenities -->
		{#if payload.openingTimes.length > 0 || payload.amenities.length > 0}
			<section class="mt-10 grid gap-6 sm:grid-cols-2">
				{#if payload.openingTimes.length > 0}
					<div>
						<h2
							class="font-display text-text-heading mb-3 text-lg font-semibold"
						>
							Opening hours
						</h2>
						<dl class="text-sm">
							{#each payload.openingTimes as time (time.day)}
								<div
									class="border-border/50 flex justify-between border-b py-1.5 last:border-b-0"
								>
									<dt class="text-text-muted">{openingDayLabel(time.day)}</dt>
									<dd class="text-text-body">{formatOpeningRow(time)}</dd>
								</div>
							{/each}
						</dl>
					</div>
				{/if}
				{#if payload.amenities.length > 0}
					<div>
						<h2
							class="font-display text-text-heading mb-3 text-lg font-semibold"
						>
							Amenities
						</h2>
						<ul class="flex flex-wrap gap-2">
							{#each payload.amenities as amenity (amenity)}
								<li
									class="bg-surface-raised border-border text-text-body rounded-lg border px-2.5 py-1 text-xs"
								>
									{amenity}
								</li>
							{/each}
						</ul>
					</div>
				{/if}
			</section>
		{/if}

		<p class="text-text-muted mt-12 text-xs leading-relaxed">
			Prices are sourced from
			<a
				href="https://www.fuel-finder.service.gov.uk/"
				class="text-text-link underline underline-offset-2">Fuel Finder</a
			>
			and refreshed within roughly 30 minutes. {cityLine ? `${station.displayName} is in ${cityLine}.` : ''}
		</p>
	</main>

	<Footer
		links={[
			{ href: '/', label: 'home' },
			{ href: '/stations', label: 'all stations' },
			{
				href: 'https://www.gov.uk/guidance/report-an-error-in-fuel-prices-or-forecourt-details',
				label: 'report data issues',
				external: true
			}
		]}
	/>
</div>

<!-- eslint-disable-next-line svelte/no-at-html-tags -->
{@html structuredData}

<style>
	.totem-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		border-radius: 1rem;
		border: 1px solid var(--color-border);
		background: linear-gradient(180deg, #0c0a14, #141019);
		padding: 1.1rem 1.4rem;
	}
	.totem-label {
		font-family: var(--font-mono);
		font-size: 0.95rem;
		color: var(--color-text-body);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.totem-price {
		font-family: var(--font-mono);
		font-weight: 700;
		font-size: clamp(2.2rem, 7vw, 3rem);
		line-height: 1;
		color: var(--color-accent);
		text-shadow: 0 0 22px rgba(92, 225, 230, 0.4);
	}
	.totem-row.diesel .totem-price {
		color: var(--color-diesel);
		text-shadow: 0 0 22px rgba(243, 201, 105, 0.35);
	}
	.totem-unit {
		font-size: 0.45em;
		font-weight: 600;
		margin-left: 0.1em;
		color: var(--color-text-muted);
		text-shadow: none;
	}
</style>
