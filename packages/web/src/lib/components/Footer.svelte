<script lang="ts">
	import { resolve } from '$app/paths'

	interface Props {
		links?: Array<{ href: string; label: string; external?: boolean }>
	}

	const {
		links = [
			{
				href: 'https://www.fuel-finder.service.gov.uk/report',
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
	{#each links as link, i}
		{#if i > 0}
			<span class="text-border">|</span>
		{/if}
		<a
			href={link.external ? link.href : resolve(link.href)}
			class="hover:text-text-body transition-colors">{link.label}</a
		>
	{/each}
</footer>
