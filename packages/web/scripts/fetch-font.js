#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const BUCKET_URL = process.env.FONT_BUCKET_URL
const API_KEY = process.env.FONT_API_KEY
const FILENAME = process.env.FONT_FILENAME

if (!BUCKET_URL || !API_KEY || !FILENAME) {
	console.warn(
		'Skipping font download — FONT_BUCKET_URL, FONT_API_KEY, or FONT_FILENAME not set'
	)
	process.exit(0)
}

const url = `${BUCKET_URL.replace(/\/+$/, '')}/${FILENAME}`
const dest = join(
	__dirname,
	'..',
	'src',
	'lib',
	'assets',
	'InnovatorGroteskVF.woff2'
)

console.log(`Downloading font from ${url} …`)

const res = await fetch(url, {
	headers: { Authorization: `Bearer ${API_KEY}` }
})

if (!res.ok) {
	console.error(`Failed to download font: ${res.status} ${res.statusText}`)
	process.exit(1)
}

const buffer = Buffer.from(await res.arrayBuffer())
await mkdir(dirname(dest), { recursive: true })
await writeFile(dest, buffer)

console.log(`Font saved to ${dest} (${buffer.byteLength} bytes)`)
