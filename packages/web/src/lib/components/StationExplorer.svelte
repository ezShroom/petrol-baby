<script lang="ts">
	import type { CompareData, FuelPrice } from '@petrol-baby/server'
	import { resolve } from '$app/paths'
	import PriceChart from '$lib/components/PriceChart.svelte'
	import { formatDistance, formatPenceUnit } from '$lib/format'

	interface Props {
		nodeId: string
		slug: string
		fuels: FuelPrice[]
		defaultFuel: string | null
		initialCompare: CompareData | null
	}

	const { nodeId, slug, fuels, defaultFuel, initialCompare }: Props = $props()

	// The component is keyed on the station nodeId by the page, so it remounts
	// per station — capturing these prop values as initial state is intended.
	// svelte-ignore state_referenced_locally
	let selectedFuel = $state(defaultFuel)
	// svelte-ignore state_referenced_locally
	let compare = $state(initialCompare)
	let activeTab = $state<'nearby' | 'cheapest'>('nearby')
	let loading = $state(false)

	const compareCache: Record<string, CompareData> = {}
	// svelte-ignore state_referenced_locally
	if (initialCompare) compareCache[initialCompare.fuelType] = initialCompare

	async function selectFuel(code: string) {
		selectedFuel = code
		const cached = compareCache[code]
		if (cached) {
			compare = cached
			return
		}
		loading = true
		try {
			const base = resolve('/station/[slug]', { slug })
			const res = await fetch(
				`${base}/compare?nodeId=${encodeURIComponent(nodeId)}&fuel=${encodeURIComponent(code)}`
			)
			if (res.ok) {
				const fresh = (await res.json()) as CompareData
				compareCache[code] = fresh
				compare = fresh
			}
		} finally {
			loading = false
		}
	}

	/**
	 * Apply a live price tick pushed over the websocket: append to the history
	 * of the matching cached fuel so the chart and lists stay current without a
	 * reload. Exposed so the page can forward socket messages.
	 */
	export function applyLivePrice(update: {
		fuelType: string
		pricePence: number
		timestamp: string
	}) {
		const cached = compareCache[update.fuelType]
		if (cached) {
			const last = cached.history[cached.history.length - 1]
			if (!last || last.timestamp !== update.timestamp) {
				cached.history = [
					...cached.history,
					{ timestamp: update.timestamp, pricePence: update.pricePence }
				]
			}
			if (update.fuelType === selectedFuel) compare = { ...cached }
		}
	}

	const comparisonRows = $derived(
		activeTab === 'nearby' ? (compare?.nearby ?? []) : (compare?.cheapest ?? [])
	)
</script>

<div class="flex flex-wrap items-center justify-between gap-3">
	<h2 class="font-display text-text-heading text-xl font-semibold">
		Price history &amp; comparisons
	</h2>
	<div class="flex flex-wrap gap-1.5" role="group" aria-label="Fuel type">
		{#each fuels as fuel (fuel.code)}
			<button
				onclick={() => selectFuel(fuel.code)}
				class="cursor-pointer rounded-lg border px-3 py-1.5 text-sm transition-colors {selectedFuel ===
				fuel.code
					? 'border-accent bg-accent/10 text-accent'
					: 'border-border text-text-body hover:text-text-heading'}"
				aria-pressed={selectedFuel === fuel.code}
			>
				{fuel.label}
			</button>
		{/each}
	</div>
</div>

<div
	class="border-border bg-surface mt-5 rounded-2xl border p-4 transition-opacity sm:p-5"
	class:opacity-60={loading}
>
	<PriceChart points={compare?.history ?? []} label={compare?.label ?? ''} />
</div>

<div class="mt-6">
	<div class="border-border flex gap-1 border-b">
		<button
			onclick={() => (activeTab = 'nearby')}
			class="cursor-pointer border-b-2 px-4 py-2 text-sm font-medium transition-colors {activeTab ===
			'nearby'
				? 'border-accent text-text-heading'
				: 'text-text-muted hover:text-text-body border-transparent'}"
		>
			Nearby
		</button>
		<button
			onclick={() => (activeTab = 'cheapest')}
			class="cursor-pointer border-b-2 px-4 py-2 text-sm font-medium transition-colors {activeTab ===
			'cheapest'
				? 'border-accent text-text-heading'
				: 'text-text-muted hover:text-text-body border-transparent'}"
		>
			Cheapest nearby
		</button>
	</div>

	<ul class="mt-3 flex flex-col gap-1">
		{#each comparisonRows as row, i (row.nodeId)}
			<li>
				<a
					href={row.slug ? resolve('/station/[slug]', { slug: row.slug }) : '#'}
					class="hover:bg-surface-raised group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors"
				>
					<span
						class="text-text-muted w-5 shrink-0 text-center font-mono text-sm"
						>{i + 1}</span
					>
					<span class="min-w-0 flex-1">
						<span
							class="text-text-heading group-hover:text-accent block truncate text-sm font-medium transition-colors"
							>{row.displayName}</span
						>
						<span class="text-text-muted block truncate text-xs">
							{[row.city, row.postcode].filter(Boolean).join(' ')}
							{#if row.distanceKm !== null}
								· {formatDistance(row.distanceKm)} away
							{/if}
						</span>
					</span>
					<span
						class="shrink-0 font-mono text-sm font-semibold tabular-nums"
						title={row.prices
							.map((p) => `${p.label}: ${formatPenceUnit(p.pricePence)}`)
							.join(' · ')}
					>
						{#each row.prices as price, idx (price.code)}
							{#if idx > 0}<span class="text-text-muted mx-0.5 font-normal"
									>/</span
								>
							{/if}<span
								style:color={idx === 0
									? 'var(--color-accent)'
									: 'var(--color-diesel)'}
								>{formatPenceUnit(price.pricePence)}</span
							>
						{/each}
					</span>
				</a>
			</li>
		{:else}
			<li class="text-text-muted px-3 py-6 text-center text-sm">
				No other stations found for this fuel.
			</li>
		{/each}
	</ul>
</div>
