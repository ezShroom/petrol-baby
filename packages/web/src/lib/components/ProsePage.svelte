<script lang="ts">
	import { resolve } from '$app/paths'
	import type { Snippet } from 'svelte'

	interface Props {
		title: string
		lastUpdated: string
		children: Snippet
	}

	const { title, lastUpdated, children }: Props = $props()
</script>

<div class="font-body bg-bg text-text-body flex min-h-dvh flex-col">
	<main class="mx-auto w-full max-w-2xl flex-1 px-8 py-16 sm:px-12">
		<a
			href={resolve('/')}
			class="text-text-muted hover:text-text-link text-sm transition-colors"
			>&larr; back</a
		>

		<h1
			class="font-display text-text-heading mt-8 text-3xl font-bold sm:text-4xl"
		>
			{title}
		</h1>
		<p class="text-text-muted mt-2 text-sm">Last updated: {lastUpdated}</p>

		<div class="mt-10 space-y-6 text-base leading-relaxed">
			{@render children()}
		</div>
	</main>
</div>
