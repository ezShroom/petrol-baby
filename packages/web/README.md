# `@petrol-baby/web`

SvelteKit frontend for `petrol.baby`. This package is optional if you only want
the MCP backend, but it is the public-facing worker used by the hosted site.

## Proprietary font setup

The site design uses `Innovator Grotesk VF` in
`src/routes/layout.css`. That font is proprietary, so this repository does not
ship it and the generated font file is ignored by Git:

- `packages/web/src/lib/assets/InnovatorGroteskVF.woff2`

If you have a licensed copy and want the same typography, keep the font in a
private object store and download it during the build with `pnpm fetch-font`.
The current script speaks the S3 API, so Cloudflare R2, AWS S3, Backblaze B2,
MinIO, or any similar bucket will work as long as you can provide an endpoint,
bucket, and credentials.

### How it works

1. Upload your `InnovatorGroteskVF.woff2` file to a protected bucket.
2. Set these build-time environment variables:
   - `FONT_BUCKET_URL`: bucket URL including the bucket name in the path, for
     example `https://<account>.r2.cloudflarestorage.com/<bucket>` or an
     equivalent S3-compatible endpoint.
   - `FONT_ACCESS_KEY_ID`: access key for the bucket.
   - `FONT_SECRET_ACCESS_KEY`: secret key for the bucket.
   - `FONT_FILENAME`: object name in the bucket, such as
     `InnovatorGroteskVF.woff2`.
3. Run `pnpm fetch-font` before `pnpm build`.
4. The script downloads the font into `src/lib/assets/InnovatorGroteskVF.woff2`
   so the SvelteKit build can bundle it.

If `FONT_BUCKET_URL` contains extra path segments after the bucket name, the
script treats them as a key prefix. That lets you store the font under paths
such as `private/fonts/InnovatorGroteskVF.woff2`.

### If you do not have the font

Skip `pnpm fetch-font` and remove it from your build command. The app will still
build; it will just fall back to the next configured sans-serif font.
