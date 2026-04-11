<script lang="ts">
	import { resolve } from '$app/paths'

	interface Props {
		links?: Array<{ href: string; label: string; external?: boolean }>
	}

	const {
		links = [
			{
				href: 'https://www.gov.uk/guidance/report-an-error-in-fuel-prices-or-forecourt-details',
				label: 'report data issues',
				external: true
			},
			{ href: '/terms', label: 'terms' },
			{ href: '/privacy', label: 'privacy' }
		]
	}: Props = $props()
</script>

<footer
	class="text-text-muted flex flex-wrap gap-x-4 gap-y-1 px-8 py-6 text-sm sm:px-12 lg:px-20"
>
	{#each links as link, i (link.href)}
		{#if i > 0}
			<span class="text-border">|</span>
		{/if}
		<a
			// @ts-expect-error We cannot resolve everything.
			href={resolve(link.external ? link.href : link.href)}
			class="hover:text-text-body transition-colors">{link.label}</a
		>
	{/each}
</footer>
