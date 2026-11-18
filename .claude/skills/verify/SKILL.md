---
name: verify
description: Build, launch, and drive this app locally to verify changes end-to-end (API + browser)
---

# Verifying the CRM locally

## Launch (two background processes)

```bash
# API — env comes from the shell, there is no .env loading anywhere.
# Connect as a NON-superuser role: superusers bypass row-level security, so a
# superuser DATABASE_URL silently disables tenant isolation and any isolation
# check you run proves nothing. One-time:
#   psql -d postgres -c "CREATE ROLE crm_app LOGIN PASSWORD 'crm_app' NOSUPERUSER NOBYPASSRLS;"
#   psql -d postgres -c "CREATE DATABASE crm1_dev OWNER crm_app;"
#   DATABASE_URL=postgres://crm_app:crm_app@127.0.0.1:5432/crm1_dev pnpm --filter @workspace/db run migrate
export DATABASE_URL=postgres://crm_app:crm_app@127.0.0.1:5432/crm1_dev
export SESSION_SECRET=local-dev-secret
export PORT=5001            # NOT 5000 (macOS AirPlay) and NOT 3000
pnpm --filter @workspace/api-server run dev

# Frontend (Vite, hot-reloads; proxies /api to the API)
PORT=3210 BASE_PATH=/ VITE_API_PROXY=http://localhost:5001 \
  pnpm --filter @workspace/web run dev
```

- **The API server has no watch mode** — restart it after backend changes
  (`dev` = esbuild build + run). The built entrypoint is `dist/index.mjs`.
- **Kill the old API before restarting.** A stale process keeps the port and
  keeps answering: `lsof -tiTCP:5001 -sTCP:LISTEN | xargs -r kill -9`.
- **Never health-check the API through the Vite proxy** — Vite answers 200
  even when the API is dead. Hit `127.0.0.1:5001/api/healthz`.
- Seeded workspaces (password `demo2026`): **Acme Demo** (`admin@acme.test`,
  `jordan@acme.test`, `sam@acme.test`) and **Globex Demo**
  (`admin@globex.test`, `riley@globex.test`, `casey@globex.test`). Re-seed
  deletes every tenant: `pnpm --filter @workspace/api-server run seed`.
- New workspaces: `POST /api/auth/signup` with
  `{workspaceName, name, email, password}` (signs the caller in).

## curl with a session

```bash
curl -s -c /tmp/a.jar -H 'content-type: application/json' \
  -d '{"email":"admin@acme.test","password":"demo2026"}' \
  http://localhost:5001/api/auth/login
curl -s -b /tmp/a.jar 'http://localhost:5001/api/deals?limit=1' | jq
```

## Checking isolation

Sign in as both seeded admins and confirm each sees only its own deals, and
that reading or patching the other workspace's deal id returns 404:

```bash
curl -s -c /tmp/g.jar -H 'content-type: application/json' \
  -d '{"email":"admin@globex.test","password":"demo2026"}' \
  http://localhost:5001/api/auth/login
curl -s -o /dev/null -w '%{http_code}\n' -b /tmp/g.jar http://localhost:5001/api/deals/1   # 404
```

## Browser driving (no Playwright in the repo)

Install `playwright-core` in the session scratchpad (NOT the repo — the
workspace has a supply-chain minimumReleaseAge guard) and reuse the cached
browser:

```bash
cd <scratchpad> && npm init -y && npm install playwright-core
```

```js
// executablePath — the cached headless shell (playwright-core downloads
// nothing). Resolve the build number instead of hardcoding it; the cache is
// currently chromium_headless_shell-1234, and it moves with the Chrome channel:
const cache = `${process.env.HOME}/Library/Caches/ms-playwright`;
const build = readdirSync(cache).find((d) => d.startsWith("chromium_headless_shell-"));
const exe = `${cache}/${build}/chrome-headless-shell-mac-arm64/chrome-headless-shell`;
const browser = await chromium.launch({ executablePath: exe, headless: true });
```

Login form selectors: `input[type="email"]`, `input[type="password"]`,
`button[type="submit"]`. After login the app redirects to `/home`.

## Gotchas found while driving

- Deal "rotting" = open + stage has `rotting_days` + `greatest(stage_change_time,
  last activity add_time, add_time)` older than threshold — to fabricate a
  rotting deal you must backdate `add_time` too (or pick a deal with no
  activities), not just `stage_change_time`.
- Each workspace starts with one default pipeline (`is_default=true`);
  `GET /pipelines` sorts default-first so consumers use `pipelines[0]`.
- Mobile layout checks: the home grid reorders with CSS `order` — compare
  bounding-box Y positions, not DOM/text order.
