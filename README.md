# Sirdab Revenue Engine

An open-source, self-hosted sales CRM in the spirit of Pipedrive: pipelines and
a drag-and-drop board, deals, people and organizations, activities, notes with
@mentions, file attachments, automations, assignment rules, saved views,
insights dashboards, a full audit history, and a Pipedrive importer. English and
Arabic (RTL) out of the box.

Built and maintained by [Sirdab](https://sirdab.co). Licensed under the
[GNU AGPL v3](LICENSE).

## Features

- **Pipelines & board**: multiple pipelines, Kanban board with drag and drop,
  stage probabilities, rotting deals, required fields per stage and for "won".
- **Deals**: list, board and forecast views; a filter builder with saved views;
  bulk edit; labels; lost reasons; merge duplicates; archive and restore.
- **Contacts**: people and organizations with their deals, activities and notes.
- **Activities**: calls, meetings, emails, tasks, deadlines and WhatsApp;
  planned vs. logged, replied / no reply outcomes, drafts.
- **Notes & comments**: rich text, @mentions, emoji reactions, link previews,
  attachments.
- **Custom fields**: a field registry for deals (text, number, money, date,
  single/multi select, …), editable from the deal page.
- **Automations**: when a deal is added or updated and matches conditions,
  create an activity or deal, call a webhook, post to Slack, or notify
  subscribers.
- **Assignment rules**: route new deals to a person or round-robin a team.
- **Insights**: dashboards of widgets (performance, funnels, win/loss,
  duration, tables, pivots) with drill-through.
- **Audit history**: every change to a deal, contact, activity or note is
  recorded, with a "recent changes" feed.
- **Notifications**: in-app, email and Slack, with per-user preferences.
- **Import**: CSV import for organizations, people and deals, plus a
  [Pipedrive sync](migrations/pipedrive-api-sync/CONTINUOUS-SYNC.md).
- **Inbound webhooks**: create and update deals from n8n, Zapier or your site.

## Quick start (Docker)

```bash
cp .env.example .env      # set SESSION_SECRET and BOOTSTRAP_ADMIN_* at least
docker compose up --build
```

Open http://localhost:8080 and sign in with `BOOTSTRAP_ADMIN_EMAIL` /
`BOOTSTRAP_ADMIN_PASSWORD`. Compose also starts MinIO (file attachments,
console on http://localhost:9001) and Mailpit (outgoing email, UI on
http://localhost:8025).

## Local development

Prerequisites: **Node 24** (`mise install` reads `mise.toml`), **pnpm 10**
(the repo refuses npm/yarn), and **Postgres 16**.

```bash
pnpm install

createdb revenue_engine
export DATABASE_URL=postgres://$USER@localhost:5432/revenue_engine
pnpm --filter @workspace/db run migrate

# Demo data (WIPES every table, local databases only)…
pnpm --filter @workspace/api-server run seed
# …or just an admin user:
BOOTSTRAP_ADMIN_EMAIL=you@example.com BOOTSTRAP_ADMIN_PASSWORD='a strong password' \
  pnpm --filter @workspace/api-server run bootstrap
```

The demo seed creates `admin@example.com` (admin), `omar@example.com` and
`sara@example.com`, all with password `demo-password-2026`.

Run the API and the frontend in two terminals. Environment comes from the
shell; nothing loads `.env` automatically (`set -a; source .env; set +a` works).

```bash
# Terminal 1: API server (no watch mode, restart after backend changes)
export DATABASE_URL=postgres://$USER@localhost:5432/revenue_engine
export SESSION_SECRET=local-dev-secret
export PORT=5001
pnpm --filter @workspace/api-server run dev

# Terminal 2: frontend, proxies /api to the API server
PORT=3000 BASE_PATH=/ VITE_API_PROXY=http://localhost:5001 \
  pnpm --filter @workspace/login run dev
```

Open http://localhost:3000. Outside production the session cookie is
`SameSite=none; Secure`; Chrome and Firefox accept that on `localhost`, Safari
may not.

### Everyday commands

```bash
pnpm run typecheck                               # the main correctness gate
pnpm run test                                    # node:test suites (Node >= 23.6)
pnpm --filter @workspace/api-spec run codegen    # after editing openapi.yaml
pnpm --filter @workspace/db run generate         # schema change -> migration file
```

## Configuration

Every variable is documented in [`.env.example`](.env.example). Only
`DATABASE_URL` and `SESSION_SECRET` are required; file attachments (any
S3-compatible store), email (any SMTP provider), Slack and Sentry each switch
themselves off when their variables are unset.

## Deploying

The [`Dockerfile`](Dockerfile) builds one image: the API server serves `/api`
and the built frontend on the same origin, port 8080. Run
`pnpm --filter @workspace/db run migrate` against your database before starting
a new version (the compose file's `migrate` service shows how). The app is
stateless and safe to run on several instances behind a load balancer.

## Repository layout

| Path | What |
|---|---|
| `artifacts/api-server` | Express 5 API, bundled with esbuild |
| `artifacts/login` | React frontend (Vite, Tailwind, Radix, React Query) |
| `lib/db` | Drizzle schema, migrations and the Postgres client |
| `lib/api-spec` | OpenAPI contract; generates `lib/api-zod` and `lib/api-client-react` |
| `lib/deals-filter` | The filter DSL shared by the server (SQL) and the client (UI) |
| `lib/insights-spec` | The insights widget spec |
| `lib/automation-placeholders` | Automation message placeholders |
| `migrations/` | Pipedrive import and sync tools |

[`CLAUDE.md`](CLAUDE.md) covers architecture and conventions;
[`SCHEMA.md`](SCHEMA.md) documents the database for data mapping and import.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security issues: see
[SECURITY.md](SECURITY.md).

## License

Copyright (C) 2026 Sirdab. Licensed under the
[GNU Affero General Public License v3.0](LICENSE). If you run a modified
version as a network service, the AGPL requires you to offer its users the
source of your version.
