# petrol.baby

Fuel price MCP server and website, deployed as a single Bun service on a VPS.

## Monorepo structure

| Package           | Description                                                              |
| ----------------- | ------------------------------------------------------------------------ |
| `packages/web`    | SvelteKit app (site + `/mcp` + `/live` endpoints), built by adapter-node |
| `packages/server` | Data backend: Bun SQLite, Fuel Finder ingestion, MCP tools, CLIs         |

Everything runs in one process: the SvelteKit server imports
`@petrol-baby/server` directly, which owns the SQLite database, the
once-a-minute Fuel Finder ingestion scheduler, the MCP tool implementations,
and the live-price SSE hub.

## Setup

> [!TIP]
> There is a public instance at [petrol.baby](https://petrol.baby/). Unless you
> have specific needs, such as very frequent queries, you should probably just
> use that.

### Prepare

The [.env.example](./packages/server/.env.example) file shows what environment
variables you'll need. You will need credentials for:

- [Fuel Finder API](https://www.developer.fuel-finder.service.gov.uk/public-api)
- [OpenRouter](https://openrouter.ai/)

The initial data backfill will likely use a bit over **$10** in OpenRouter
credit. When stations change their information, they will sometimes need to be
processed again, so there will be _some_ minimal usage over time as well. If
this is important to you, track the usage to ensure you are happy with it.

The Fuel Finder API appears to block non-UK IPs, so run the service on a
UK-based host. `FUEL_FINDER_BASE_URL` can point at the staging API or a mock
server for testing.

### Deploy

See [deploy/README.md](./deploy/README.md) for the full VPS runbook (systemd
unit, Cloudflare Tunnel, initial backfill, backups). The short version:

```bash
bun install --frozen-lockfile
bun run build
cd packages/server && bun run data:backfill   # once, foreground, resumable
bun packages/web/build/index.js               # or the systemd unit
```

The service reports `503` on `/readyz` (and MCP tools return a friendly
error) until the backfill has completed.

### Verify

Check whether it worked by connecting to the `/mcp` endpoint on your public
URL from your MCP client of choice, and by opening a station page.

## Contributions

Contributions are welcome &mdash; just ensure that any code you contribute is
legitimately helpful, and that any code written by agents has been tracked
using [Git AI](https://github.com/git-ai-project/git-ai) (disclose whether AI
was used to write your contributed code in the PR).

## Local development

You will need [Bun](https://bun.com/) — it is both the package manager and the
runtime (the backend uses `bun:sqlite`, so the dev server runs `vite` via
`bun --bun`).

To run the setup locally:

```bash
bun install
bun run dev
```

The web dev server needs the server package's environment variables (see
`packages/server/.env.example`); point `DATABASE_PATH` at any writable
absolute path.

To check code quality, use:

```
bun run check-types
bun run lint
bun run test
bun run style
```

### Font

There is an optional proprietary font fetch step for the web package; see
[`packages/web/README.md`](./packages/web/README.md). The site uses Innovator
Grotesk, which is not committed to the repository. If you have a licensed
copy, set `FONT_BUCKET_URL`, `FONT_ACCESS_KEY_ID`, `FONT_SECRET_ACCESS_KEY`,
and `FONT_FILENAME`, then run `bun run fetch-font` before building. Without
it the site falls back to system sans-serif fonts.
