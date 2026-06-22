/// <reference types="bun-types" />

import { sveltekit } from '@sveltejs/kit/vite'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	server: { allowedHosts: process.env.NODE_ENV === 'development' || undefined }
})
