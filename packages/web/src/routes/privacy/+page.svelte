<script lang="ts">
	import Footer from '$lib/components/Footer.svelte'
	import ProsePage from '$lib/components/ProsePage.svelte'
</script>

<svelte:head>
	<title>privacy policy - petrol.baby</title>
</svelte:head>

<ProsePage title="Privacy Policy" lastUpdated="April 2026">
	<h2 class="text-text-heading text-xl font-semibold">
		What petrol.baby collects
	</h2>
	<p>
		The petrol.baby MCP server does not collect, store, or process any personal
		data. Your queries are forwarded to the
		<a
			href="https://www.fuel-finder.service.gov.uk/"
			class="text-text-link underline underline-offset-2">Fuel Finder</a
		>
		public API to retrieve fuel price data and are not logged or retained.
	</p>

	<h2 class="text-text-heading text-xl font-semibold">Analytics</h2>
	<p>
		We use PostHog on the backend to track aggregate usage metrics such as
		active users and request counts. This data is used solely to understand how
		the service is being used and to inform development priorities. No
		personally identifiable information is collected through this.
	</p>

	<h2 class="text-text-heading text-xl font-semibold">Third-party services</h2>
	<p>
		If you use petrol.baby through
		<a
			href="https://poke.com"
			class="text-text-link underline underline-offset-2">Poke</a
		>
		or any other agent, you are additionally subject to that service's own privacy
		policy. petrol.baby has no control over how those services handle your data.
	</p>

	<h2 class="text-text-heading text-xl font-semibold">Changes</h2>
	<p>
		This policy may be updated from time to time. Continued use of petrol.baby
		constitutes acceptance of the current policy.
	</p>
</ProsePage>

<Footer
	links={[
		{ href: '/', label: 'home' },
		{ href: '/terms', label: 'terms' }
	]}
/>
