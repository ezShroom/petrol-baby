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
		The petrol.baby MCP server processes your requests against a local database
		in order to respond to them, after which the content of the request is
		discarded. Only the information that you or your agent choose to provide by
		making requests, such as a region to check prices in, is processed.
	</p>
	<p>
		If you open a location probe link and allow access to your precise
		geolocation, your coordinates will be retained for one day to allow your
		agent to retrieve them, after which they are automatically discarded.
	</p>
	<p>
		By using the integration, you consent your data being processed in this way.
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

	<h2 class="text-text-heading text-xl font-semibold">Contact</h2>
	<p>
		If you have any questions about this privacy policy or want to exercise your
		GDPR rights, contact <a
			href="mailto:privacy@petrol.baby"
			class="text-text-link underline underline-offset-2">privacy@petrol.baby</a
		>.
	</p>
</ProsePage>

<Footer
	links={[
		{ href: '/', label: 'home' },
		{ href: '/terms', label: 'terms' }
	]}
/>
