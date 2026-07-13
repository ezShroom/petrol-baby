# Deployment

petrol.baby runs as a single Bun process on a UK VPS, published through a
Cloudflare Tunnel. There is no reverse proxy, Docker, or Cloudflare Worker.

```
Cloudflare Tunnel (cloudflared)
        │
        ▼
127.0.0.1:3000  ← systemd-supervised Bun process
  ├── SvelteKit site (station pages, search, sitemap)
  ├── POST /mcp        MCP endpoint (stateless Streamable HTTP, JSON)
  ├── GET  /live       live prices (SSE)
  ├── GET  /healthz    liveness
  ├── GET  /readyz     readiness (503 until backfilled)
  ├── scheduler        Fuel Finder ingestion, every minute
  └── SQLite           /var/lib/petrol-baby/petrol-baby.sqlite
```

## First-time setup

```bash
# 1. Install Bun (pin the version in package.json packageManager)
curl -fsSL https://bun.sh/install | bash

# 2. Service user + checkout
sudo useradd --system --home /opt/petrol-baby --shell /usr/sbin/nologin petrol-baby
sudo git clone <repo> /opt/petrol-baby
sudo chown -R petrol-baby:petrol-baby /opt/petrol-baby

# 3. Secrets (never in the repo)
sudo tee /etc/petrol-baby.env > /dev/null <<'EOF'
FUEL_FINDER_CLIENT_ID=...
FUEL_FINDER_CLIENT_SECRET=...
OPENROUTER_API_KEY=...
EOF
sudo chmod 600 /etc/petrol-baby.env

# 4. Install units
sudo cp deploy/petrol-baby.service deploy/petrol-baby-backup.* /etc/systemd/system/
sudo systemctl daemon-reload

# 5. Build
cd /opt/petrol-baby
sudo -u petrol-baby bun install --frozen-lockfile
sudo -u petrol-baby bun run build

# 6. Initial data backfill (foreground; resumable; uses ~$10 of OpenRouter
#    credit; the API requires a UK IP). Re-run it if interrupted — cleaned
#    stations are recognised by hash and not re-billed.
cd packages/server
sudo -u petrol-baby \
  DATABASE_PATH=/var/lib/petrol-baby/petrol-baby.sqlite \
  $(sudo cat /etc/petrol-baby.env | xargs) \
  bun run data:backfill

# 7. Start
sudo systemctl enable --now petrol-baby petrol-baby-backup.timer
curl -s http://127.0.0.1:3000/healthz
curl -s http://127.0.0.1:3000/readyz   # 200 once backfilled
```

## Cloudflare Tunnel

Point the existing tunnel's public hostname at the service:

```yml
ingress:
  - hostname: petrol.baby
    service: http://127.0.0.1:3000
  - service: http_status:404
```

Keep `disableChunkedEncoding` unset (false) so `/live` SSE streams. The app
trusts `ORIGIN` from the unit file rather than forwarded headers.

## Deploying updates

```bash
cd /opt/petrol-baby
sudo -u petrol-baby git pull
sudo -u petrol-baby bun install --frozen-lockfile
sudo -u petrol-baby bun run build
sudo systemctl restart petrol-baby
journalctl -u petrol-baby -f
```

Database migrations run automatically at startup (and in the CLIs) before
any request is served.

## Backups

`petrol-baby-backup.timer` takes a daily `VACUUM INTO` snapshot into
`/var/lib/petrol-baby/backups`, verifies its integrity, and keeps the newest 7. The database contains Fuel Finder OAuth tokens — keep backups permissioned
like the database and copy them off the host yourself.

Restore = stop the service, copy a snapshot over `DATABASE_PATH` (remove any
`-wal`/`-shm` siblings), start the service.

## Operational notes

- **One process only.** SQLite has a single writer; never run two instances
  against the same database file. `bun run data:backfill` refuses to run
  while another maintenance pass is active in its own process but cannot see
  other processes — stop the service before running a manual backfill, or
  simply let the running service handle incremental updates.
- The scheduler never starts the initial backfill on its own; a fresh
  database serves 503 on `/readyz` until `data:backfill` has been run.
- `/mcp` is stateless: GET/DELETE return 405, each POST is an isolated MCP
  server. No session ids are issued.
- Rate limiting is best applied at the Cloudflare zone (the origin is only
  reachable through the tunnel).
