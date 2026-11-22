# Sirdab Revenue Engine

An open-source, multi-tenant sales CRM in the spirit of Pipedrive, built on
Sirdab's [One](https://github.com/sirdab/one) design system. Track deals
through pipelines on a Kanban board, keep people and organizations with their
activities and notes, automate the busywork and see how the pipeline is doing.

Built and maintained by [Sirdab](https://sirdab.co). Licensed under
[MIT](LICENSE); the Sirdab name and logos are [trademarks](TRADEMARKS.md).

**Try it:** a free hosted instance runs at
[revenue-engine.fly.dev](https://revenue-engine.fly.dev). Sign up and you get
a workspace of your own.

**Features**

- **Pipelines and deals**: multiple pipelines, a drag-and-drop board, win
  probabilities, "rotting" deals, required fields per stage, won/lost reasons,
  deal merge, archive and restore.
- **Contacts**: people and organizations, linked to deals, with activities
  (calls, meetings, tasks), notes with @mentions and comments, and file
  attachments.
- **Custom fields and saved views**: your own deal fields, a filter builder,
  saved list views, CSV/XLSX export.
- **Automation**: assignment rules that pick a deal's owner, and "when a deal
  matches, do this" automations (create an activity, create a deal, call a
  webhook, post to Slack, notify people).
- **Insights**: configurable dashboards over deals, activities and
  organizations.
- **Search and import**: global search (phone numbers too) and a guided CSV
  import with duplicate detection that recognises Pipedrive exports of
  organizations, people and deals.
- **Ask AI** (optional): a read-only assistant that answers questions about
  your pipeline using the Claude API.
- **Workspaces**: anyone can sign up and get an isolated workspace, enforced by
  Postgres row-level security. Admins manage users, teams, labels, pipelines
  and integrations.
- **English and Arabic** UI, including right-to-left layout.
- **A public landing page**: `/` is a prerendered marketing site (English and
  Arabic, with a sitemap, structured data and share images), so a hosted
  instance has a front door. The app sits behind `/login` and `/signup`.

Stack: TypeScript everywhere. Express 5 + Drizzle ORM + PostgreSQL on the
server, React 19 + Vite + Tailwind + [Sirdab One](https://github.com/sirdab/one)
on the client, an OpenAPI contract with generated clients.

## Quick start

You need **Node 24** (`mise.toml` pins it), **pnpm 10** and **Docker** (or a
Postgres 13+ of your own, see below).

```bash
pnpm install
cp .env.example .env          # then set SESSION_SECRET (openssl rand -hex 32)
pnpm db:setup                 # starts Postgres, file storage and Mailpit in Docker, migrates, loads demo data
pnpm dev                      # API on :5001, web app on :3210
```

Open **http://localhost:3210**. The demo data has two workspaces:

| Workspace | Users | Password |
|---|---|---|
| Acme Demo | `admin@acme.test`, `jordan@acme.test`, `sam@acme.test` | `demo2026` |
| Globex Demo | `admin@globex.test`, `riley@globex.test`, `casey@globex.test` | `demo2026` |

Signing in as either admin shows only that workspace. You can also skip the
demo data (`pnpm db:up && pnpm db:migrate`) and create a workspace from the
sign-up page.

`pnpm db:up` (part of `db:setup`) starts everything in
[`docker-compose.yml`](docker-compose.yml), and `.env.example` points the app
at it, so file attachments and email work out of the box:

| Service | What | Open |
|---|---|---|
| Postgres | the database | `localhost:5432` |
| RustFS | S3-compatible storage for attachments | http://localhost:9001/rustfs/console/ (`rustfsadmin` / `rustfsadmin`) |
| Mailpit | catches every outgoing email | http://localhost:8025 |

> ⚠️ `pnpm seed` (part of `db:setup`) **deletes every workspace** before
> loading the demo. Only point it at a local database.

### Using your own Postgres

Tenant isolation is enforced by row-level security, which **superusers and
BYPASSRLS roles skip**. Connect as an ordinary role, even locally, or you are
not testing isolation at all:

```bash
psql -d postgres -c "CREATE ROLE crm_app LOGIN PASSWORD 'crm_app' NOSUPERUSER NOBYPASSRLS;"
psql -d postgres -c "CREATE DATABASE crm OWNER crm_app;"
# DATABASE_URL=postgres://crm_app:crm_app@localhost:5432/crm in .env
pnpm db:migrate && pnpm seed
```

### Good to know

- `.env` at the repo root is read by `pnpm dev`, `pnpm db:migrate`, `pnpm seed`
  and `pnpm bootstrap`. Variables set in your shell win. Production never reads
  it.
- The API server has no watch mode (`dev` builds, then runs). Restart
  `pnpm dev` after backend changes; the frontend hot-reloads.
- Outside production the session cookie is `SameSite=none; Secure`. Chrome and
  Firefox keep it on `localhost`; Safari may not.
- Optional integrations switch themselves off when not configured: email
  without `SMTP_HOST`, Ask AI without `ANTHROPIC_API_KEY`. File attachments
  need S3-compatible storage (the S3 variables); without it, uploads fail.
  Slack is connected per workspace in Settings → Integrations. All variables
  are listed in [`.env.example`](.env.example).
- If port 5432 is taken (say, by a Postgres you already run), start the
  services with `DB_PORT=5433 pnpm db:up` and use port 5433 in `DATABASE_URL`.

## Self-hosting

The `Dockerfile` builds one image that serves both the API and the web app on
one port. To try it locally:

```bash
docker compose --profile app up -d --build     # http://localhost:8080
```

The container uses the Compose database, file storage and Mailpit, so it is a
try-out rather than a deployment.

> **Apple silicon:** the image is linux/amd64 only (the workspace ships only
> linux-x64 native build tools), and esbuild tends to crash under Docker's
> amd64 emulation during `vite build`. Build the image on an amd64 machine or in
> CI, or use `pnpm dev` locally.

The container runs `node dist/migrate.mjs` (the committed migrations, safe to
run on every start) and then the server. To create the first admin without the
sign-up page, set the `BOOTSTRAP_*` variables and run `pnpm bootstrap`.

For production, see [`DEPLOY.md`](DEPLOY.md). It covers Fly.io (including
optional auto-deploy from GitHub Actions); any container host with Postgres
works the same way. In short: run as a non-superuser database role, set a long
random `SESSION_SECRET`, serve over HTTPS and set `APP_BASE_URL`.

## Project layout

A pnpm-workspace monorepo:

| Path | What |
|---|---|
| `artifacts/api-server` | Express 5 API (esbuild bundle) |
| `artifacts/web` | React web app (Vite, React Query, [Sirdab One](https://github.com/sirdab/one)), plus the public landing pages in `src/marketing` |
| `lib/db` | Drizzle schema, migrations and the tenant-scoped `db` handle |
| `lib/api-spec` | `openapi.yaml`, the API contract; generates `lib/api-zod` and `lib/api-client-react` |
| `lib/deals-filter`, `lib/insights-spec`, `lib/automation-placeholders` | Shared between server and client |
| `scripts` | Dev runner and i18n tooling |

Architecture, tenancy and conventions: [`CLAUDE.md`](CLAUDE.md). Domain
vocabulary: [`CONCEPTS.md`](CONCEPTS.md). Database: [`SCHEMA.md`](SCHEMA.md).
Schema changes: [`lib/db/MIGRATIONS.md`](lib/db/MIGRATIONS.md).

## Everyday commands

```bash
pnpm dev                                          # API + web app
pnpm run typecheck                                # libs + every package
pnpm run test                                     # node:test suites (Node ≥ 23.6)
pnpm codegen                                      # after editing openapi.yaml
pnpm --filter @workspace/db run generate          # schema change → migration file
pnpm db:migrate                                   # apply migrations
```

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). Report security issues privately, as
described in [`SECURITY.md`](SECURITY.md).

## License

The code is [MIT](LICENSE), copyright Sirdab. The Sirdab name, logos and brand
images are not covered by the licence: forks that are distributed or hosted
replace them, as described in [`TRADEMARKS.md`](TRADEMARKS.md).
