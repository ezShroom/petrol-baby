#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3'

const __dirname = dirname(fileURLToPath(import.meta.url))

const BUCKET_URL = process.env.FONT_BUCKET_URL
const ACCESS_KEY_ID = process.env.FONT_ACCESS_KEY_ID
const SECRET_ACCESS_KEY = process.env.FONT_SECRET_ACCESS_KEY
const FILENAME = process.env.FONT_FILENAME

if (!BUCKET_URL || !ACCESS_KEY_ID || !SECRET_ACCESS_KEY || !FILENAME) {
	console.warn(
		'Skipping font download — FONT_BUCKET_URL, FONT_ACCESS_KEY_ID, FONT_SECRET_ACCESS_KEY, or FONT_FILENAME not set'
	)
	process.exit(0)
}

// Parse the bucket URL to extract the S3 endpoint and bucket name.
// e.g. "https://<account>.r2.cloudflarestorage.com/my-bucket" →
//   endpoint: "https://<account>.r2.cloudflarestorage.com"
//   bucket:   "my-bucket"
const parsed = new URL(BUCKET_URL)
const endpoint = parsed.origin
const pathParts = parsed.pathname.split('/').filter(Boolean)
const bucket = pathParts[0]

if (!bucket) {
	console.error(
		'FONT_BUCKET_URL must include the bucket name in the path (e.g. https://<account>.r2.cloudflarestorage.com/<bucket>)'
	)
	process.exit(1)
}

// Any extra path segments after the bucket become a key prefix.
const keyPrefix = pathParts.slice(1).join('/')
const key = keyPrefix ? `${keyPrefix}/${FILENAME}` : FILENAME

const client = new S3Client({
	region: 'auto',
	endpoint,
	credentials: {
		accessKeyId: ACCESS_KEY_ID,
		secretAccessKey: SECRET_ACCESS_KEY
	}
})

console.log(`Downloading s3://${bucket}/${key} …`)

const response = await client.send(
	new GetObjectCommand({ Bucket: bucket, Key: key })
)

const bytes = await response.Body.transformToByteArray()
const dest = join(
	__dirname,
	'..',
	'src',
	'lib',
	'assets',
	'InnovatorGroteskVF.woff2'
)

await mkdir(dirname(dest), { recursive: true })
await writeFile(dest, bytes)

console.log(`Font saved to ${dest} (${bytes.byteLength} bytes)`)
