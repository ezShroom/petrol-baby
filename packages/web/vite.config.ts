import { sveltekit } from '@sveltejs/kit/vite'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	server: { allowedHosts: process.env.NODE_ENV === 'development' || undefined },
	ssr: {
		// The backend package uses bun:sqlite and reads prompt/migration
		// files from disk; it must run as real source under Bun, never be
		// bundled by Vite. (Its entry is a .js shim because Vite refuses to
		// externalize packages that resolve to .ts files.) This is also why
		// `vite dev`/`vite build` run via `bun --bun`.
		external: ['@petrol-baby/server']
	},
	optimizeDeps: {
		exclude: ['@petrol-baby/server']
	}
})
