/// <reference types="bun-types" />

import { sveltekit } from '@sveltejs/kit/vite'
import tailwindcss from '@tailwindcss/vite'
import svelteKitWebSockets from 'vite-plugin-sveltekit-cf-websockets'
import { defineConfig } from 'vite'

export default defineConfig({
	plugins: [tailwindcss(), svelteKitWebSockets(), sveltekit()],
	server: { allowedHosts: process.env.NODE_ENV === 'development' || undefined }
})
