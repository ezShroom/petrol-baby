# petrol.baby

petrol.baby is a Bun monorepo with two packages:

- `packages/server` — the data backend. Owns the SQLite database
  (`bun:sqlite` + Drizzle ORM), ingestion from the
  [Fuel Finder Public API](https://www.developer.fuel-finder.service.gov.uk/public-api),
  the MCP tool implementations, the live-price SSE hub, and the operational
  CLIs (`data:backfill`, `data:backup`). We retain up to 14 days of pricing
  history, except the latest event per station and fuel type is always kept
  even if older.
- `packages/web` — a SvelteKit frontend built with `@sveltejs/adapter-node`
  and run under Bun. It serves the public site and exposes `POST /mcp`
  (stateless Streamable HTTP, JSON responses), `GET /live` (SSE),
  `/healthz`, and `/readyz`. It imports `@petrol-baby/server` directly —
  there is no separate backend process.

## Architecture rules

- **One process, one SQLite writer.** `PetrolBabyService` is a process-wide
  singleton (`getSharedService()`); never create a second instance against
  the same database file.
- `@petrol-baby/server` always runs as TypeScript source under Bun. It is
  externalized from the Vite/adapter-node bundle (its package entry is a
  `.js` shim because Vite refuses to externalize `.ts` entries). Do not add
  code to it that cannot run under plain Bun, and do not import it from
  client-side code.
- MCP is stateless: a fresh `McpServer` + transport per POST. Do not add
  session state, subscriptions, or server-initiated notifications without
  revisiting the transport setup in `packages/server/src/mcp.ts`.
- The scheduler (started by the web app's server `init` hook) only runs
  incremental updates and pruning. The initial backfill is exclusively the
  foreground `bun run data:backfill` CLI.
- The LLM prompts in `packages/server/src/prompts/*.md` are read from disk at
  module load (`info_cleaner.ts`); don't convert them to bundler imports.

## General API information

The Fuel Finder API collects data into paginated batches. Each batch is made
up of 500 data points / stations / etc. It appears to block non-UK IPs.

## Documentation

- [OAuth endpoints](https://www.developer.fuel-finder.service.gov.uk/apis-ifr/access-token/docs)
- [Data endpoints](https://www.developer.fuel-finder.service.gov.uk/apis-ifr/info-recipent/docs)

## Tooling

This project uses **Bun** as both package manager and runtime (the
`packageManager` field pins the exact version) and **Turborepo** for task
orchestration. Common commands from the repo root:

```
bun install
bun run dev          # vite dev under Bun (needs server env vars)
bun run build        # adapter-node output at packages/web/build
bun run test         # bun test in packages/server
bun run check-types
bun run lint
bun run style
```

Deployment (systemd + Cloudflare Tunnel) is documented in
[deploy/README.md](./deploy/README.md).
