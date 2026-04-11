/// <reference types="bun-types" />

import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({ plugins: [tailwindcss(), sveltekit()], server: { allowedHosts: process.env.NODE_ENV === 'development' || undefined } });
