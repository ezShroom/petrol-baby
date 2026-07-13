/**
 * JavaScript entry shim.
 *
 * Vite will only externalize a package whose resolved entry is a `.js` file
 * (`canExternalizeFile`), and this package must stay external: it uses
 * `bun:sqlite` and reads prompt/migration files from disk, so it has to run
 * as real source under Bun rather than being bundled into the SvelteKit
 * server output. Bun happily imports the TypeScript source through this
 * shim; types resolve via the "types" condition in package.json.
 */
export * from './src/index.ts'
