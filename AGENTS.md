# petrol.baby

petrol.baby is a pnpm monorepo with two packages:

- `packages/worker` — a Cloudflare Worker + Durable Object MCP server that
  provides agents with information about fuel prices from the
  [Fuel Finder Public API](https://www.developer.fuel-finder.service.gov.uk/public-api),
  and allows them to easily filter through it in a way that is useful to the
  user. We retain up to 14 days of pricing history, except the latest event
  per station and fuel type is always kept even if older.
- `packages/web` — a SvelteKit frontend deployed as a Cloudflare Worker. It
  is the public-facing entrypoint for all traffic and proxies `/mcp` requests
  to the backend worker via a Cloudflare service binding.

## General API information

The Fuel Finder API collects data into paginated batches. Each batch is made up
of 500 data points / stations / etc.

## Documentation

- [OAuth endpoints](https://www.developer.fuel-finder.service.gov.uk/apis-ifr/access-token/docs)
- [Data endpoints](https://www.developer.fuel-finder.service.gov.uk/apis-ifr/info-recipent/docs)

## Package manager

This project uses **pnpm** as its package manager and **Turborepo** for task
orchestration. The `packageManager` field in the root `package.json` pins the
exact pnpm version.

## Monorepo layout

```
packages/
  web/       — SvelteKit frontend (Cloudflare Workers adapter, Tailwind CSS)
  worker/    — MCP backend (Cloudflare Worker + Durable Object, Drizzle ORM)
```

The web worker forwards `/mcp` to the backend worker using a Cloudflare
`services` binding named `MCP_BACKEND`.
