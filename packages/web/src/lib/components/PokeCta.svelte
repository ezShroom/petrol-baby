<script lang="ts">
	import pokeLogo from '$lib/assets/interaction_icon_black.svg'

	interface Props {
		/** Optional station name to personalise the headline. */
		stationName?: string | null
		/** Visual density: `card` for station pages, `banner` for the index. */
		variant?: 'card' | 'banner'
	}

	const { stationName = null, variant = 'card' }: Props = $props()

	const recipeUrl = 'https://poke.com/r/UcGmvmDWcAB'

	const heading = $derived(
		stationName
			? `Track ${stationName} with Poke`
			: 'Let Poke do the legwork'
	)
</script>

<div
	class="poke-cta border-border bg-surface-raised relative overflow-hidden rounded-2xl border p-5 sm:p-6"
	class:banner={variant === 'banner'}
>
	<div class="relative z-1 flex flex-col gap-3">
		<div>
			<p class="text-text-heading font-display text-lg font-semibold">
				{heading}
			</p>
			<p class="text-text-body mt-1 text-sm leading-relaxed">
				Get a daily price check, compare nearby stations, and ask for the
				cheapest fuel around you in plain English — automatically, every day.
				It's free with Poke.
			</p>
		</div>
		<a
			href={recipeUrl}
			class="poke-btn group inline-flex w-fit items-center justify-center gap-2.5 rounded-xl bg-white px-5 py-3 text-base font-medium text-black transition-all duration-200 hover:shadow-lg hover:shadow-white/10 active:scale-[0.98]"
		>
			<img src={pokeLogo} alt="" class="h-5 w-5" aria-hidden="true" />
			Use with Poke
		</a>
	</div>
</div>

<style>
	.poke-cta::before {
		content: '';
		position: absolute;
		inset: 0;
		background: radial-gradient(
			ellipse 80% 90% at 90% 0%,
			rgba(92, 225, 230, 0.12) 0%,
			transparent 60%
		);
		pointer-events: none;
	}

	.poke-btn:hover {
		box-shadow:
			0 0 0 1px rgba(255, 255, 255, 0.15),
			0 8px 24px rgba(255, 255, 255, 0.08);
		transform: translateY(-1px);
	}
</style>
