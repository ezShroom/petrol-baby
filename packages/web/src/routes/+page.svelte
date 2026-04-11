<script lang="ts">
	import pokeLogo from '$lib/assets/interaction_icon_black.svg'
	import ogImage from '$lib/assets/opengraph.png'
	import Footer from '$lib/components/Footer.svelte'
	import { slide } from 'svelte/transition'

	let showOtherAgents = $state(false)
	let copied = $state(false)
	const mcpUrl = 'https://petrol.baby/mcp'

	function copyUrl() {
		navigator.clipboard.writeText(mcpUrl)
		copied = true
		setTimeout(() => (copied = false), 2000)
	}
</script>

<svelte:head>
	<title>petrol.baby - find better fuel prices</title>
	<meta
		name="description"
		content="Give your AI agents the ability to search for petrol station data from the entire United Kingdom. Prices always up-to-date within 30 minutes."
	/>
	<meta property="og:title" content="petrol.baby - find better fuel prices" />
	<meta
		property="og:description"
		content="Give your AI agents the ability to search for petrol station data from the entire United Kingdom. Prices always up-to-date within 30 minutes."
	/>
	<meta property="og:image" content="https://petrol.baby{ogImage}" />
	<meta property="og:url" content="https://petrol.baby" />
	<meta property="og:type" content="website" />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content="petrol.baby - find better fuel prices" />
	<meta
		name="twitter:description"
		content="Give your AI agents the ability to search for petrol station data from the entire United Kingdom. Prices always up-to-date within 30 minutes."
	/>
	<meta name="twitter:image" content="https://petrol.baby{ogImage}" />
</svelte:head>

<!-- SVG filter for outside-only text outline -->
<svg class="absolute h-0 w-0" aria-hidden="true">
	<filter id="outside-stroke">
		<feMorphology
			operator="dilate"
			radius="0.75"
			in="SourceAlpha"
			result="dilated"
		/>
		<feComposite
			operator="out"
			in="dilated"
			in2="SourceAlpha"
			result="outline"
		/>
		<feFlood flood-color="var(--color-text-heading)" result="color" />
		<feComposite operator="in" in="color" in2="outline" />
	</filter>
</svg>

<div class="font-body bg-bg flex min-h-dvh flex-col">
	<main class="flex flex-1 flex-col lg:flex-row">
		<!-- Left: Hero column -->
		<div
			class="left-column flex flex-1 items-center justify-center px-10 pt-16 pb-10 sm:px-16 lg:py-0"
		>
			<div class="w-full max-w-[520px]">
				<h1
					class="font-display text-text-heading text-5xl leading-[1.05] font-extrabold tracking-tight sm:text-6xl lg:text-7xl"
				>
					<span class="text-stroke">petrol.baby</span> is an integration to help you
					find better fuel prices.
				</h1>
				<p class="text-text-body mt-7 text-lg leading-relaxed sm:text-xl">
					Give your agents the ability to search for petrol station data from
					the entire United Kingdom, powered by <a
						href="https://www.fuel-finder.service.gov.uk/"
						class="text-text-link underline underline-offset-2 transition-colors hover:brightness-125"
						>Fuel Finder</a
					>. Prices are always up-to-date within 30 minutes.
				</p>
			</div>
		</div>

		<!-- Right: Install + Chat preview -->
		<div
			class="flex flex-1 flex-col items-center justify-center gap-8 px-8 py-10 sm:px-12 lg:px-16 lg:pt-12 lg:pb-0"
		>
			<!-- Poke CTA -->
			<div class="flex w-full max-w-md flex-col gap-4">
				<p class="text-text-muted text-sm">
					Poke is the easiest way to get started with petrol.baby.
				</p>
				<a
					href="https://poke.dev/mcp?url=https://petrol.baby/mcp"
					class="poke-btn group flex items-center justify-center gap-3 rounded-xl bg-white px-6 py-4 text-lg font-medium text-black transition-all duration-200 hover:shadow-lg hover:shadow-white/10 active:scale-[0.98]"
				>
					<img src={pokeLogo} alt="Poke" class="h-5 w-5" />
					Use with Poke
				</a>

				<!-- Other agents -->
				<div>
					<button
						onclick={() => (showOtherAgents = !showOtherAgents)}
						class="text-text-muted flex w-full cursor-pointer items-center justify-between py-2 text-sm transition-colors"
					>
						<span>Using a different agent?</span>
						<svg
							class="h-4 w-4 transition-transform duration-200 {showOtherAgents
								? 'rotate-180'
								: ''}"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<path d="m6 9 6 6 6-6" />
						</svg>
					</button>

					{#if showOtherAgents}
						<div
							transition:slide={{ duration: 200 }}
							class="border-border bg-surface-raised overflow-hidden rounded-xl border"
						>
							<div class="px-4 py-3">
								<p class="text-text-muted mb-2 text-xs tracking-wide uppercase">
									MCP endpoint
								</p>
								<div class="flex gap-2" style="--copy-row-h: 42px;">
									<code
										class="copy-target bg-surface text-text-heading border-border flex-1 rounded-lg border px-3 py-2.5 font-mono text-sm select-all"
									>
										{mcpUrl}
									</code>
									<button
										onclick={copyUrl}
										class="copy-btn bg-surface border-border text-text-body hover:text-text-heading flex shrink-0 cursor-pointer items-center justify-center rounded-lg border transition-colors"
										title="Copy URL"
									>
										{#if copied}
											<svg
												class="text-accent h-4 w-4"
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												stroke-width="2.5"
												stroke-linecap="round"
												stroke-linejoin="round"
											>
												<path d="M20 6 9 17l-5-5" />
											</svg>
										{:else}
											<svg
												class="h-4 w-4"
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												stroke-width="2"
												stroke-linecap="round"
												stroke-linejoin="round"
											>
												<rect
													width="14"
													height="14"
													x="8"
													y="8"
													rx="2"
													ry="2"
												/>
												<path
													d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"
												/>
											</svg>
										{/if}
									</button>
								</div>
								<p class="text-text-muted mt-2 text-xs">
									Add this URL as a remote MCP server in Claude Desktop, Cursor,
									Windsurf, or any agent that supports MCP.
								</p>
							</div>
						</div>
					{/if}
				</div>
			</div>

			<!-- Chat preview -->
			<div
				class="w-full max-w-md overflow-hidden rounded-2xl shadow-2xl shadow-black/40"
			>
				<div class="aurora-bg relative flex flex-col gap-2 px-4 py-5">
					<!-- Noise grain -->
					<svg
						class="pointer-events-none absolute inset-0 z-2 h-full w-full opacity-[0.35] mix-blend-overlay"
					>
						<filter id="grain">
							<feTurbulence
								type="fractalNoise"
								baseFrequency="0.7"
								numOctaves="4"
								stitchTiles="stitch"
							/>
							<feColorMatrix type="saturate" values="0" />
						</filter>
						<rect width="100%" height="100%" filter="url(#grain)" />
					</svg>

					<!-- User message -->
					<div class="z-1 flex justify-end">
						<div
							class="bg-bubble-sent max-w-[75%] rounded-2xl rounded-br-sm px-4 py-2.5 text-sm text-white shadow-md"
						>
							where's the cheapest diesel in brighton at right now?
						</div>
					</div>

					<!-- Agent messages -->
					<div class="z-1 flex justify-start">
						<div
							class="bubble-received text-bubble-text max-w-[80%] rounded-2xl rounded-bl-sm px-4 py-2.5 text-sm shadow-md"
						>
							one sec i'll check those prices for you
						</div>
					</div>

					<div class="z-1 flex justify-start">
						<div
							class="bubble-received text-bubble-text max-w-[85%] rounded-2xl rounded-bl-sm px-4 py-2.5 text-sm shadow-md"
						>
							valero woodingdean is leading in brighton at 187.9p
						</div>
					</div>

					<div class="z-1 flex justify-start">
						<div
							class="bubble-received text-bubble-text max-w-[85%] rounded-2xl rounded-bl-sm px-4 py-3 text-sm shadow-md"
						>
							<div class="space-y-0.5">
								<p>brighton (diesel)</p>
								<p>valero woodingdean — 187.9p</p>
								<p>asda hollingbury — 188.9p</p>
								<p>asda brighton marina — 188.9p</p>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	</main>

	<Footer />
</div>

<style>
	.text-stroke {
		filter: url(#outside-stroke);
	}

	.left-column {
		background: linear-gradient(
			to bottom,
			var(--color-bg-raised),
			var(--color-bg)
		);
	}

	.poke-btn:hover {
		box-shadow:
			0 0 0 1px rgba(255, 255, 255, 0.15),
			0 8px 24px rgba(255, 255, 255, 0.08);
		transform: translateY(-1px);
	}

	.aurora-bg {
		background: #0c0a14;
		position: relative;
		overflow: hidden;
	}

	.aurora-bg::before {
		content: '';
		position: absolute;
		inset: 0;
		background:
			radial-gradient(
				ellipse 70% 55% at 75% 20%,
				rgba(120, 50, 220, 0.6) 0%,
				rgba(120, 50, 220, 0.2) 35%,
				transparent 65%
			),
			radial-gradient(
				ellipse 60% 50% at 20% 80%,
				rgba(40, 180, 200, 0.45) 0%,
				rgba(40, 180, 200, 0.12) 35%,
				transparent 65%
			),
			radial-gradient(
				ellipse 45% 45% at 50% 45%,
				rgba(180, 50, 160, 0.35) 0%,
				rgba(180, 50, 160, 0.08) 40%,
				transparent 65%
			),
			radial-gradient(
				ellipse 50% 40% at 80% 75%,
				rgba(30, 140, 100, 0.25) 0%,
				transparent 55%
			);
		animation: aurora-shift 20s ease-in-out infinite alternate;
	}

	.aurora-bg::after {
		content: '';
		position: absolute;
		inset: 0;
		background:
			radial-gradient(
				ellipse 55% 45% at 30% 30%,
				rgba(100, 40, 200, 0.3) 0%,
				transparent 55%
			),
			radial-gradient(
				ellipse 35% 55% at 65% 70%,
				rgba(50, 200, 220, 0.3) 0%,
				transparent 50%
			);
		animation: aurora-shift 25s ease-in-out infinite alternate-reverse;
	}

	@keyframes aurora-shift {
		0% {
			transform: scale(1) translate(0, 0);
		}
		33% {
			transform: scale(1.05) translate(2%, -2%);
		}
		66% {
			transform: scale(0.98) translate(-1%, 2%);
		}
		100% {
			transform: scale(1.03) translate(-2%, -1%);
		}
	}

	.copy-target,
	.copy-btn {
		height: var(--copy-row-h);
	}

	.copy-btn {
		width: var(--copy-row-h);
	}

	.bubble-received {
		background-color: rgba(255, 255, 255, 0.12);
		backdrop-filter: blur(12px);
	}
</style>
