# petrol.baby

Fuel price MCP server with a SvelteKit frontend, deployed on Cloudflare Workers.

## Monorepo structure

| Package | Description |
| --- | --- |
| `packages/web` | SvelteKit frontend (public-facing worker) |
| `packages/worker` | MCP backend (Durable Object + Cloudflare Worker) |

The web worker is the public entrypoint. It serves the frontend and proxies `/mcp` requests to the backend worker via a Cloudflare service binding.

## Commands

```bash
pnpm install
pnpm dev
pnpm build
pnpm check-types
pnpm lint
pnpm style
```
