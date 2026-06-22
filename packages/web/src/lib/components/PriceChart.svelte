<script lang="ts">
	import { formatPence } from '$lib/format'

	interface Point {
		timestamp: string
		pricePence: number
	}

	interface Props {
		points: Point[]
		label?: string
	}

	const { points, label = '' }: Props = $props()

	const WIDTH = 720
	const HEIGHT = 240
	const PAD = { top: 24, right: 16, bottom: 28, left: 44 }

	let hovered = $state<number | null>(null)
	let svgEl = $state<SVGSVGElement>()

	const plot = $derived.by(() => {
		const valid = points
			.map((p) => ({ t: new Date(p.timestamp).getTime(), v: p.pricePence }))
			.filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v))
			.sort((a, b) => a.t - b.t)

		if (valid.length === 0) return null

		const tMin = valid[0].t
		const tMax = valid[valid.length - 1].t
		const tSpan = Math.max(1, tMax - tMin)

		const values = valid.map((p) => p.v)
		const realMin = Math.min(...values)
		const realMax = Math.max(...values)
		let vMin = realMin
		let vMax = realMax
		if (vMin === vMax) {
			vMin -= 1
			vMax += 1
		}
		const vPad = (vMax - vMin) * 0.18
		vMin -= vPad
		vMax += vPad
		const vSpan = vMax - vMin

		const innerW = WIDTH - PAD.left - PAD.right
		const innerH = HEIGHT - PAD.top - PAD.bottom

		// A single point can't span a width, so pin it to the centre.
		const x = (t: number) =>
			valid.length === 1
				? PAD.left + innerW / 2
				: PAD.left + ((t - tMin) / tSpan) * innerW
		const y = (v: number) => PAD.top + (1 - (v - vMin) / vSpan) * innerH

		const coords = valid.map((p) => ({ x: x(p.t), y: y(p.v), v: p.v, t: p.t }))
		const line = coords
			.map(
				(c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`
			)
			.join(' ')
		const area =
			`M${coords[0].x.toFixed(1)},${(HEIGHT - PAD.bottom).toFixed(1)} ` +
			coords.map((c) => `L${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ') +
			` L${coords[coords.length - 1].x.toFixed(1)},${(HEIGHT - PAD.bottom).toFixed(1)} Z`

		const last = coords[coords.length - 1]
		const lo = coords.reduce((a, b) => (b.v < a.v ? b : a))
		const hi = coords.reduce((a, b) => (b.v > a.v ? b : a))

		const ticks = (
			realMin === realMax
				? [realMax]
				: [realMax, (realMin + realMax) / 2, realMin]
		).map((v) => ({ v, y: y(v) }))

		return {
			coords,
			line,
			area,
			last,
			lo,
			hi,
			ticks,
			single: valid.length === 1,
			startLabel: fmtDay(tMin),
			endLabel: fmtDay(tMax),
			pointCount: valid.length
		}
	})

	function fmtDay(ms: number) {
		return new Date(ms).toLocaleDateString('en-GB', {
			day: 'numeric',
			month: 'short'
		})
	}
	function fmtDateTime(ms: number) {
		return new Date(ms).toLocaleString('en-GB', {
			day: 'numeric',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit'
		})
	}

	const active = $derived(
		plot && hovered !== null ? (plot.coords[hovered] ?? null) : null
	)
	// Tooltip x clamped so it stays inside the plot.
	const tipX = $derived(
		active
			? Math.min(Math.max(active.x, PAD.left + 60), WIDTH - PAD.right - 60)
			: 0
	)

	function onMove(event: PointerEvent) {
		if (!plot || !svgEl) return
		const rect = svgEl.getBoundingClientRect()
		const vbX = ((event.clientX - rect.left) / rect.width) * WIDTH
		let nearest = 0
		let best = Infinity
		for (let i = 0; i < plot.coords.length; i++) {
			const d = Math.abs(plot.coords[i].x - vbX)
			if (d < best) {
				best = d
				nearest = i
			}
		}
		hovered = nearest
	}
</script>

{#if plot}
	<figure class="m-0">
		<svg
			bind:this={svgEl}
			viewBox="0 0 {WIDTH} {HEIGHT}"
			class="h-auto w-full touch-none"
			role="img"
			aria-label={`Price history chart${label ? ` for ${label}` : ''}`}
			preserveAspectRatio="none"
			onpointermove={onMove}
			onpointerleave={() => (hovered = null)}
		>
			<defs>
				<linearGradient id="price-area" x1="0" y1="0" x2="0" y2="1">
					<stop
						offset="0%"
						stop-color="var(--color-accent)"
						stop-opacity="0.28"
					/>
					<stop
						offset="100%"
						stop-color="var(--color-accent)"
						stop-opacity="0"
					/>
				</linearGradient>
			</defs>

			{#each plot.ticks as tick, i (i)}
				<line
					x1={PAD.left}
					x2={WIDTH - PAD.right}
					y1={tick.y}
					y2={tick.y}
					stroke="var(--color-border)"
					stroke-width="1"
					stroke-dasharray="3 4"
					opacity="0.5"
				/>
				<text
					x={PAD.left - 8}
					y={tick.y + 4}
					text-anchor="end"
					font-size="12"
					fill="var(--color-text-muted)"
					font-family="var(--font-mono)"
				>
					{formatPence(tick.v)}
				</text>
			{/each}

			{#if !plot.single}
				<path d={plot.area} fill="url(#price-area)" />
				<path
					d={plot.line}
					fill="none"
					stroke="var(--color-accent)"
					stroke-width="2.5"
					stroke-linejoin="round"
					stroke-linecap="round"
				/>
			{/if}

			<!-- low / high markers with value labels -->
			<circle
				cx={plot.lo.x}
				cy={plot.lo.y}
				r="3.5"
				fill="var(--color-accent)"
			/>
			<circle
				cx={plot.hi.x}
				cy={plot.hi.y}
				r="3.5"
				fill="var(--color-text-muted)"
			/>

			<!-- current point + persistent price label -->
			<circle
				cx={plot.last.x}
				cy={plot.last.y}
				r="4.5"
				fill="var(--color-accent)"
				stroke="var(--color-bg)"
				stroke-width="2"
			/>
			<text
				x={plot.last.x}
				y={plot.last.y - 12}
				text-anchor="middle"
				font-size="13"
				font-weight="700"
				fill="var(--color-text-heading)"
				font-family="var(--font-mono)"
			>
				{formatPence(plot.last.v)}p
			</text>

			<!-- hover guide -->
			{#if active}
				<line
					x1={active.x}
					x2={active.x}
					y1={PAD.top}
					y2={HEIGHT - PAD.bottom}
					stroke="var(--color-accent)"
					stroke-width="1"
					opacity="0.5"
				/>
				<circle
					cx={active.x}
					cy={active.y}
					r="5"
					fill="var(--color-accent)"
					stroke="var(--color-bg)"
					stroke-width="2"
				/>
				<g transform="translate({tipX}, {PAD.top - 6})">
					<rect
						x="-58"
						y="-6"
						width="116"
						height="40"
						rx="8"
						fill="var(--color-surface-raised)"
						stroke="var(--color-border)"
					/>
					<text
						x="0"
						y="10"
						text-anchor="middle"
						font-size="14"
						font-weight="700"
						fill="var(--color-text-heading)"
						font-family="var(--font-mono)"
					>
						{formatPence(active.v)}p
					</text>
					<text
						x="0"
						y="26"
						text-anchor="middle"
						font-size="10"
						fill="var(--color-text-muted)"
					>
						{fmtDateTime(active.t)}
					</text>
				</g>
			{/if}

			<text
				x={PAD.left}
				y={HEIGHT - 8}
				font-size="12"
				fill="var(--color-text-muted)"
				font-family="var(--font-mono)"
			>
				{plot.startLabel}
			</text>
			{#if !plot.single}
				<text
					x={WIDTH - PAD.right}
					y={HEIGHT - 8}
					text-anchor="end"
					font-size="12"
					fill="var(--color-text-muted)"
					font-family="var(--font-mono)"
				>
					{plot.endLabel}
				</text>
			{/if}
		</svg>
	</figure>
{:else}
	<div
		class="border-border text-text-muted flex h-40 items-center justify-center rounded-xl border border-dashed text-sm"
	>
		No recent price history for this fuel.
	</div>
{/if}
