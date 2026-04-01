# petrol-baby

Minimal Cloudflare Worker + Durable Object MCP starting point.

## What is here

- `src/index.ts` exposes a simple health check at `/healthz` and routes MCP traffic to `/mcp`.
- `src/petrol-baby-mcp.ts` defines `PetrolBabyObject` as an `McpAgent`, following the same basic pattern used in `../poke-steno`.
- The durable object persists a tiny `greetings` table in DO SQLite so there is a stateful example to build on.

## MCP tools

- `say_hello`: stores and returns a greeting, optionally personalized with `name`.
- `recent_greetings`: returns the latest stored greetings from the durable object's SQLite storage.

## Commands

```bash
bun install
bun run dev
bun run check-types
```
