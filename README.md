# petrol.baby

Fuel price MCP server deployed on Cloudflare Workers.

## Monorepo structure

| Package           | Description                                      |
| ----------------- | ------------------------------------------------ |
| `packages/web`    | SvelteKit frontend (public-facing worker)        |
| `packages/worker` | MCP backend (Durable Object + Cloudflare Worker) |

The web worker is the public entrypoint. It serves the frontend and proxies
`/mcp` requests to the backend worker via a Cloudflare service binding.

## Setup

> [!TIP]
> There is a public instance at [petrol.baby](https://petrol.baby/). Unless you
> have specific needs, such as very frequent queries, you should probably just
> use that &mdash; deploying for yourself is more difficult and you will likely
> want some existing skill or experience with deploying to Cloudflare (though
> Claude should be able to help if you're new to this).

### Prepare

The [.env.example](./packages/worker/.env.example) file shows what environment
variables you'll need to set the project up. You will need credentials for:

- [Fuel Finder API](https://www.developer.fuel-finder.service.gov.uk/public-api)
- [OpenRouter](https://openrouter.ai/)

The initial data backfill will likely use a bit over **$10** in OpenRouter
credit. When stations change their information, they will sometimes need to be
processed again, so there will be _some_ minimal usage over time as well. If
this is important to you, track the usage to ensure you are happy with it.

It is also **likely** that you will want to use a UK-based reverse proxy for
the Fuel Finder API, as it appears to block non-UK IPs from accessing it.
Because the cron job for updating price data can spin up anywhere, regardless
of where you use the MCP from, it is still likely to run in different places.

It may be possible to change this restriction for your account by [contacting
the Fuel Finder team](https://www.developer.fuel-finder.service.gov.uk/contact-us),
but I have not tried it.

The `USE_API` variable can be populated with `test`, `prod`, or your reverse
proxy's URL. If you have auth set up on your reverse proxy, use
`FUEL_FINDER_EXTRA_HEADERS`.

### Deploy

> [!CAUTION]
> The initial backfill, which is necessary to get started, **requires** the
> Workers Paid tier as it makes [more than 50
> subrequests](https://developers.cloudflare.com/workers/platform/limits/#account-plan-limits).
> While less likely, it is possible that you will need to make more than 50
> subrequests for an update as well.

The easiest way to deploy, if you are running on a fork of the repo, is using
Workers Builds. Go to [Workers and
Pages](https://dash.cloudflare.com/?to=/:account/workers-and-pages), and create
two Workers:

**`petrol-baby-mcp`**

- Root directory: `/`
- Build command: `cd packages/worker && pnpm run build`
- Deploy command: `cd packages/worker && pnpm wrangler deploy`
- Version command: `cd packages/worker && pnpm wrangler versions upload`

Set your environment variables (`USE_API`, `OPENROUTER_API_KEY`,
`FUEL_FINDER_CLIENT_SECRET`, etc) **after** successfully deploying in the
dashboard &mdash; before deploying, you can only configure build-time
environment variables, which are irrelevant for this package.

**`petrol-baby-web`**

> [!NOTE]
> The web frontend is optional. If you do not configure this you will not have
> a homepage or a way of running location probes. To make this work, simply
> connect `petrol-baby-mcp` to a public domain instead of only
> `petrol-baby-web`.

There is an optional proprietary font fetch step for this package; see
[`packages/web/README.md`](./packages/web/README.md) for the full setup. The
site uses Innovator Grotesk, which is not committed to the repository. If you
have a licensed copy and want the same design, upload the `.woff2` file to a
private S3-compatible bucket such as Cloudflare R2, AWS S3, or similar, then
let `pnpm fetch-font` download it during the build. If you do not want to set
this up, omit `pnpm fetch-font` from the build command and the site will fall
back to system sans-serif fonts.

- Root directory: `/`
- Build command: `cd packages/web && pnpm fetch-font && pnpm run build`
- Deploy command: `cd packages/web && pnpm wrangler deploy`
- Version command: `cd packages/web && pnpm wrangler versions upload`
- Environment variables: Your `FONT_BUCKET_URL`, `FONT_ACCESS_KEY_ID`,
  `FONT_SECRET_ACCESS_KEY`, and `FONT_FILENAME` for downloading Innovator
  Grotesk from that protected bucket at build time.

Ensure that the environment variables are present at build-time &mdash; they
are not needed afterwards.

### Verify

Check whether it worked by connecting to the `/mcp` endpoint on your public URL
from your MCP client of choice. If this does not work, it means that something
is wrong.

## Contributions

Contributions are welcome &mdash; just ensure that any code you contribute is
legitimately helpful, and that any code written by agents has been tracked
using [Git AI](https://github.com/git-ai-project/git-ai) (disclose whether AI
was used to write your contributed code in the PR).

## Local development

You will need [pnpm](https://pnpm.io) installed, as well a reasonably recent
version of [Node.js](https://nodejs.org/). [Bun](https://bun.com/) can be more
efficient at running scripts, but pnpm should be used for package management.

To run the setup locally, run:

```bash
pnpm install
pnpm dev
```

To check code quality, use:

```
pnpm check-types
pnpm lint
pnpm style
```
