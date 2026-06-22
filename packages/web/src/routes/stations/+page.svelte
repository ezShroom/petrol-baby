<script lang="ts">
	import { resolve } from '$app/paths'
	import Footer from '$lib/components/Footer.svelte'
	import PokeCta from '$lib/components/PokeCta.svelte'
	import type { PageData } from './$types'

	const SITE = 'https://petrol.baby'
	let { data }: { data: PageData } = $props()

	const nextHref = $derived.by(() => {
		if (!data.nextCursor) return null
		const parts = [`cursor=${encodeURIComponent(data.nextCursor)}`]
		if (data.query) parts.unshift(`q=${encodeURIComponent(data.query)}`)
		return `${resolve('/stations')}?${parts.join('&')}`
	})
</script>

<svelte:head>
	<title>All UK fuel stations &amp; live prices | petrol.baby</title>
	<meta
		name="description"
		content="Browse every fuel station in the United Kingdom and jump to live prices, 14-day history and nearby comparisons for each one."
	/>
	<link rel="canonical" href="{SITE}/stations" />
	{#if data.isFiltered}
		<meta name="robots" content="noindex, follow" />
	{/if}
</svelte:head>

<div class="font-body bg-bg text-text-body flex min-h-dvh flex-col">
	<main class="mx-auto w-full max-w-3xl flex-1 px-6 py-10 sm:px-8 sm:py-14">
		<a
			href={resolve('/')}
			class="text-text-muted hover:text-text-link text-sm transition-colors"
			>&larr; home</a
		>

		<h1
			class="font-display text-text-heading mt-6 text-3xl font-extrabold tracking-tight sm:text-4xl"
		>
			UK fuel stations
		</h1>
		<p class="text-text-body mt-2 max-w-prose">
			Every station we track, each with live prices, recent history and nearby
			comparisons on its own page.
		</p>

		<div class="mt-6">
			<PokeCta variant="banner" />
		</div>

		<!-- Search -->
		<form method="GET" action={resolve('/stations')} class="mt-8 flex gap-2">
			<input
				type="search"
				name="q"
				value={data.query}
				placeholder="Search by name, town or postcode…"
				class="border-border bg-surface text-text-heading placeholder:text-text-muted focus:border-accent flex-1 rounded-xl border px-4 py-2.5 text-sm transition-colors outline-none"
			/>
			<button
				type="submit"
				class="border-border bg-surface-raised text-text-body hover:text-text-heading cursor-pointer rounded-xl border px-4 py-2.5 text-sm transition-colors"
			>
				Search
			</button>
		</form>

		<!-- Listing -->
		<ul
			class="border-border mt-6 divide-y divide-[var(--color-border)] border-y"
		>
			{#each data.items as item (item.nodeId)}
				<li>
					<a
						href={resolve('/station/[slug]', { slug: item.slug })}
						class="hover:bg-surface-raised group flex items-center justify-between gap-3 px-2 py-3 transition-colors"
					>
						<span class="min-w-0">
							<span
								class="text-text-heading group-hover:text-accent block truncate text-sm font-medium transition-colors"
								>{item.displayName}</span
							>
							<span class="text-text-muted block truncate text-xs">
								{[item.city, item.postcode].filter(Boolean).join(' ')}
							</span>
						</span>
						<span class="text-text-muted shrink-0 text-xs">view prices →</span>
					</a>
				</li>
			{:else}
				<li class="text-text-muted px-2 py-10 text-center text-sm">
					No stations matched “{data.query}”.
				</li>
			{/each}
		</ul>

		{#if nextHref}
			<!-- eslint-disable svelte/no-navigation-without-resolve -->
			<div class="mt-6 flex justify-center">
				<a
					href={nextHref}
					data-sveltekit-noscroll
					class="border-border bg-surface-raised text-text-body hover:text-text-heading rounded-xl border px-5 py-2.5 text-sm transition-colors"
				>
					Load more stations
				</a>
			</div>
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
		{/if}
	</main>

	<Footer
		links={[
			{ href: '/', label: 'home' },
			{ href: '/terms', label: 'terms' },
			{ href: '/privacy', label: 'privacy' }
		]}
	/>
</div>
