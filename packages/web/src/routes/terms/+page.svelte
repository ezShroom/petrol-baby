<script lang="ts">
	import Footer from '$lib/components/Footer.svelte'
	import ProsePage from '$lib/components/ProsePage.svelte'
</script>

<svelte:head>
	<title>terms of service - petrol.baby</title>
</svelte:head>

<ProsePage title="Terms of Service" lastUpdated="April 2026">
	<p>
		petrol.baby is an open-source project. The source code is available at
		<a
			href="https://github.com/ezShroom/petrol-baby"
			class="text-text-link underline underline-offset-2"
			>github.com/ezShroom/petrol-baby</a
		>
		and is provided under the terms of its licence.
	</p>
	<p>
		Contains public sector information licensed under the <a
			href="https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/"
			class="text-text-link underline underline-offset-2"
			>Open Government Licence v3.0</a
		> with additional terms.
	</p>

	<h2 class="text-text-heading text-xl font-semibold">Fair usage</h2>
	<p>
		petrol.baby is a shared, hosted service. Please don't set up automations
		that poll the MCP endpoint frequently on a recurring basis (e.g. every few
		minutes). The service is designed for interactive use through an agent, not
		as a data pipeline.
	</p>
	<p>
		If you need high-frequency or automated access to fuel price data, the
		project is open source &mdash; you're welcome to
		<a
			href="https://github.com/ezShroom/petrol-baby"
			class="text-text-link underline underline-offset-2">fork the repository</a
		>, sign up for your own
		<a
			href="https://www.developer.fuel-finder.service.gov.uk/"
			class="text-text-link underline underline-offset-2">Fuel Finder API</a
		>
		keys, and run your own instance with no restrictions.
	</p>

	<h2 class="text-text-heading text-xl font-semibold">No warranties</h2>
	<p>
		petrol.baby is provided as-is, without warranty of any kind. Fuel price data
		comes from the
		<a
			href="https://www.fuel-finder.service.gov.uk/"
			class="text-text-link underline underline-offset-2">Fuel Finder</a
		>
		public API and may be inaccurate or delayed. We are not responsible for decisions
		made based on this data.
	</p>

	<h2 class="text-text-heading text-xl font-semibold">Changes</h2>
	<p>
		These terms may be updated from time to time. Continued use of petrol.baby
		constitutes acceptance of the current terms.
	</p>
</ProsePage>

<Footer
	links={[
		{ href: '/', label: 'home' },
		{ href: '/privacy', label: 'privacy' }
	]}
/>
