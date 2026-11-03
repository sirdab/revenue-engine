# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A **multi-tenant CRM / sales-pipeline app**: deals, contacts (people and organizations), activities, notes, a Kanban board, custom deal fields, saved views, assignment rules, automations, insights dashboards, global search, CSV import and an AI assistant. Each customer is an isolated **workspace** (tenant), created self-serve from the sign-up page. It is a **pnpm-workspace monorepo** deployed on Fly.io (Node 24; multiple machines can serve at once, so treat all state as multi-instance). In production the API server and the built frontend are served same-origin under `/api`.

## Monorepo layout

`lib/*` are shared libraries, `artifacts/*` are deployable apps. All are `@workspace/*` and consume each other via `workspace:*`.

| Package | Name | Role |
|---|---|---|
| `lib/db` | `@workspace/db` | **Source of truth for the database** — Drizzle ORM schema, the pooled client, and the **tenant-scoped `db` handle** (`src/tenant-context.ts`). Exports `./` and `./schema`. |
| `lib/api-spec` | `@workspace/api-spec` | **Source of truth for the API contract** — `openapi.yaml` + Orval codegen config. Generates the two packages below. |
| `lib/api-zod` | `@workspace/api-zod` | **Generated** Zod request/response schemas + TS types (do not hand-edit `generated/`). |
| `lib/api-client-react` | `@workspace/api-client-react` | **Generated** React Query hooks + a hand-written `custom-fetch.ts` mutator. |
| `lib/deals-filter` | `@workspace/deals-filter` | Shared filter DSL (Zod). Used by **both** server (compiles to parameterized SQL, plus an in-memory evaluator for rules) and client (condition builder + URL encoding). |
| `lib/insights-spec` | `@workspace/insights-spec` | Insights widget spec (scopes: deals, activities, organizations). |
| `lib/automation-placeholders` | `@workspace/automation-placeholders` | `{{deal.*}}` placeholder whitelist shared by server and wizard. |
| `artifacts/api-server` | `@workspace/api-server` | Express 5 backend. esbuild-bundled. |
| `artifacts/web` | `@workspace/web` | The React frontend — Vite, wouter routing, Tailwind v4, Radix/shadcn UI, React Query, English + Arabic. |
| `scripts` | — (plain files) | `dev.mjs` / `with-env.mjs` (root `.env` loading, `pnpm dev`) and the i18n tooling. |

## Commands

Run from the repo root unless noted.

```bash
pnpm dev                           # API (:5001) + web (:3210) with the root .env loaded
pnpm db:setup                      # docker compose Postgres + migrate + ⚠️ seed
pnpm run typecheck                 # libs (tsc --build) + per-package typecheck
pnpm run test                      # node --test suites (api-server, web, deals-filter); needs Node ≥23.6
pnpm run build                     # typecheck, then build all packages

pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/web run typecheck

pnpm --filter @workspace/api-server run dev        # build + start (PORT required)
pnpm --filter @workspace/api-server run bootstrap  # idempotent: one admin + workspace from BOOTSTRAP_* secrets
pnpm --filter @workspace/api-server run seed       # ⚠️ DELETES every tenant, loads two demo workspaces

pnpm --filter @workspace/web run dev               # requires PORT and BASE_PATH

pnpm --filter @workspace/api-spec run codegen      # after editing openapi.yaml

pnpm --filter @workspace/db run generate           # schema change → drizzle/NNNN_*.sql (commit both)
pnpm --filter @workspace/db run migrate            # apply migrations with drizzle-kit (local, CI)
pnpm --filter @workspace/api-server run migrate    # same migrations via the bundled dist/migrate.mjs (Fly release_command in production)
pnpm --filter @workspace/db run push               # local shortcut — skips the custom RLS migration, see MIGRATIONS.md
```

Tests use the built-in `node:test` runner via tsx: `*.test.ts` files live next to the code they cover. Strict TypeScript remains the broad gate.

## Multi-tenancy (read this before touching any query)

**Isolation is enforced by Postgres row-level security, not by WHERE clauses.** Every tenant-scoped table has a `tenant_id` column (`tenantIdColumn()` in `lib/db/src/schema/tenants.ts`) and the `tenant_isolation` policy (`tenantPolicy()`), FORCEd in migration `0001` so the owning role is subject to it. The policy compares `tenant_id` with the connection setting `app.tenant_id`; the column default is that same setting, so inserts never pass it.

How a query gets its tenant (`lib/db/src/tenant-context.ts`):

- `db` (from `@workspace/db`) is a proxy that resolves, per call, to the database of the **current scope**, carried in `AsyncLocalStorage`. Each scope has a `ScopedPool` that stamps every pooled client it checks out with `app.tenant_id` / `app.bypass_rls` before running anything. So a client can never carry one tenant's setting into another tenant's query, and fire-and-forget work started by a request (notifications, Slack, webhooks) still runs as that tenant.
- `requireAuth` (`api-server/src/lib/auth.ts`) loads the session user in the system scope, then runs the rest of the request in `runWithTenant(user.tenantId, next)`. **Every router mounted after `requireAuth` is tenant-scoped automatically.**
- Inbound webhooks (`routes/webhooks.ts`) have no session: a router-level middleware resolves the tenant from the presented shared secret (`tenantIdForWebhookSecret`) and binds it the same way.
- `runAsSystem(fn)` bypasses RLS. It is only for code that precedes a tenant (login, sign-up, password reset, webhook-secret lookup) or spans tenants on purpose (`forEachTenant` in `lib/tenants.ts`; `reconcileFieldIndexes`, which manages indexes on the shared `deals` table). **Never** wrap signed-in request handling in it.
- Outside any scope a query sees no rows and every insert fails (`tenant_id` is NOT NULL) — the safe failure. A background job must use `forEachTenant`.

Consequences worth knowing:

- **The app must connect as a role that is neither superuser nor BYPASSRLS** (those skip RLS even when forced). Locally too — see README.
- **Uniqueness is per tenant.** Unique indexes lead with `tenant_id` (labels, lost reasons, deal fields, `deals.external_id`, `app_settings (tenant_id, key)`). The exception is **`users.email`, unique across all workspaces**, because the email alone identifies the workspace at sign-in. Pipelines and stages use serial ids — never compute an id as `max(id)+1` (RLS hides other tenants' rows, so it collides).
- **Foreign keys do not check tenants.** A row can reference another tenant's id at the database level. RLS hides the joined row, so nothing leaks, but write paths should validate references by reading them (an RLS-scoped read), as the deal routes do for stages and pipelines.
- **Per-tenant configuration lives in `app_settings`**, never in env vars: the inbound-webhook secret, the **Slack connection** (`slack_bot_token`, `slack_webhook_url`, `slack_announce_channel`, via `GET/PUT /api/settings/slack`; the secrets are write-only), and automation message chips. Process-wide env is only for platform concerns (database, SMTP, Anthropic, Sentry).
- **No raw-SQL tool for the AI assistant**: an LLM-authored statement could change `app.tenant_id`. The assistant uses fixed, tenant-scoped tools only.
- New tables: follow the checklist in `lib/db/MIGRATIONS.md`.
- Workspaces: `tenants` table (`name`, unique `slug`). `POST /api/auth/signup` creates tenant + first admin + a default pipeline with five stages + the native deal-field registry entries (`createWorkspace`). `GET/PATCH /api/workspace` reads/renames the caller's workspace (rename is admin-only). `/auth/me` returns the user with `tenantId` and `workspace`.

## The two codegen/source-of-truth chains

1. **API contract**: edit `lib/api-spec/openapi.yaml` → run `codegen` → regenerates `api-zod` and `api-client-react`. The server validates with the generated Zod schemas and the client calls the generated hooks. **Never hand-edit anything under `generated/`.** A few routes are hand-written and spec-less (multipart file upload, `settings/*`), called with small fetch helpers in `web/src/lib`.
2. **Database**: edit `lib/db/src/schema/*` → `generate` → commit the migration with the schema. `SCHEMA.md` documents the schema for data mapping/import; note its field-naming gotchas (the org link is `organizationId` on persons/deals but **`orgId`** on activities/notes; the note author is **`userId`**, not `ownerId`).

DB columns are `snake_case`; the API/app uses `camelCase`.

## Backend architecture

- `src/index.ts` → `src/app.ts` (pino-http, compression, CORS, cookie-parser signed with `SESSION_SECRET`, router at `/api`, static frontend + SPA fallback) → `src/routes/index.ts`. At boot, `forEachTenant` backfills the native deal-field registry for every workspace.
- `routes/index.ts` mounts public routers (`health`, `auth`, `webhooks`) first, then `requireAuth` — **every router after that line is authenticated and tenant-scoped**. Admin-only routes additionally use `requireAdmin`.
- `src/lib/` holds cross-cutting helpers: `auth.ts` (sessions, scrypt, reset tokens, tenant binding), `tenants.ts` (workspace creation, `forEachTenant`), `queries.ts` (deal/activity query builders, the filter compiler, `APP_TZ`), `change-events.ts` (audit log), `deal-fields.ts` (field registry), `assignment.ts` / `automations.ts` (rule engines, run inline in the deal-write transaction), `slack.ts`, `webhook-dispatch.ts`, `notifications.ts`, `mailer.ts` / `email.ts`, `assistant*.ts`, `insights/*`, `rate-limit.ts` (Postgres-backed store).
- **Auth**: scrypt password hashing; the session is a signed cookie `sid` carrying `${userId}.${passwordChangedEpoch}`, so a password change instantly revokes older sessions. Cookie `SameSite` is `lax` in production (same-origin) but `none; Secure` in dev.
- **Dates**: date filters, buckets and "today" use one app time zone, `APP_TIMEZONE` (default `UTC`): `APP_TZ` in `queries.ts`, `APP_TIMEZONE` in `assistant-dates.ts`, and the rule evaluator in `deals-filter`. It is process-wide, not per tenant.
- **Files**: deal attachments live in S3-compatible object storage keyed by `crm_files.id`; every read goes through the RLS-scoped metadata row first.
- **Build**: `build.mjs` runs esbuild to bundle `index` / `seed` / `bootstrap` / `migrate` as ESM, externalizing native modules.

## Frontend architecture

- `src/App.tsx` is the router: `wouter` `<Switch>`, wrapped in `QueryClientProvider` + `AuthProvider`. `/`, `/signup`, `/forgot-password` and `/reset-password` are public; everything else is gated by `<AuthGuard>` (some `adminOnly`) inside `<AppLayout>`.
- Data fetching goes through the **generated** `@workspace/api-client-react` hooks; auth is cookie-based (do **not** use `setAuthTokenGetter` in the web app).
- UI is Tailwind v4 + Radix primitives (shadcn-style components under `src/components/ui`). Path alias: `@` → `src`. Strings go through the i18n layer (`src/lib/i18n`, English and Arabic).
- The frontend reads `PORT` and `BASE_PATH` from env at config time and **throws if either is missing**.

## Environment variables

Required: `DATABASE_URL` (Postgres, as a non-superuser, non-BYPASSRLS role), `SESSION_SECRET` (api-server), `PORT` + `BASE_PATH` (frontend). Locally, `pnpm dev` / `db:*` / `seed` read them from a root `.env` (see `.env.example`); production reads only the real environment.

Optional, process-wide:
- `APP_BASE_URL` — deployed URL, used for links in emails and Slack cards.
- `APP_NAME` — product name in emails (default `CRM`).
- `APP_TIMEZONE` — IANA zone for date filters and buckets (default `UTC`).
- `PHONE_COUNTRY_CODE` — calling code without `+` (e.g. `44`) so phone search and import dedupe treat `07700…` and `+44 7700…` as one number. Unset: no country assumed.
- `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` / `BOOTSTRAP_ADMIN_NAME` / `BOOTSTRAP_WORKSPACE_NAME` — the bootstrap script.
- **Email (AWS SES SMTP)**: `AWS_SES_SMTP_ENDPOINT`, `AWS_SES_SMTP_USER`, `AWS_SES_SMTP_PASSWORD` (secret), `AWS_SMTP_PORT`, `MAIL_FROM`. When absent, sends are skipped (best-effort emails log a dev fallback; "resend login details" returns 503).
- **Ask AI**: `ANTHROPIC_API_KEY`. The assistant answers from fixed tools (`search_crm`, `get_record_context`, `find_owner`, `get_deal`, `list_deals`, `deals_moved_to_stage`, `pipeline_summary`, `deal_stats`) that all run through the tenant-scoped `db`.
- **File storage**: `S3_ENDPOINT`, `S3_BUCKET_NAME`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, optional `S3_REGION` (`lib/object-storage.ts`).
- **Sentry**: `SENTRY_DSN` (api-server) and `VITE_SENTRY_DSN` (frontend build arg); no-op when unset.
- `SLACK_STUB=1` (local dev only) captures Slack sends into an in-memory outbox (`GET /api/dev/slack-outbox`) instead of calling Slack.

Slack is **not** configured by env: each workspace connects its own in Settings → Integrations.

## Workspace conventions & gotchas

- **pnpm only.** The root `preinstall` hook refuses non-pnpm installs.
- **Supply-chain guard**: `pnpm-workspace.yaml` sets `minimumReleaseAge: 1440`. Do not disable it; use `minimumReleaseAgeExclude` only for trusted scopes.
- **Dependency versions** are centralized in the `catalog:` block of `pnpm-workspace.yaml`. `react`/`react-dom` are pinned to exactly `19.1.0`.
- The esbuild/rollup/lightningcss native-binary `overrides` strip all platforms except linux-x64 (prod) and darwin-arm64 (local dev) — don't add other platforms back, and don't re-strip darwin-arm64.
- TypeScript is strict (`strictNullChecks`, `noImplicitAny`, `noImplicitReturns`, `noFallthroughCasesInSwitch`); `moduleResolution: bundler` with a custom `workspace` export condition.
- `CONCEPTS.md` — shared domain vocabulary (workspace, tenant/system scope, deal, rotting, automation, claim, outcome).
- Phone search compares stored numbers on `phoneDigits` (digits, leading zeros dropped; `phoneDigitsSql` in `queries.ts`, mirrored byte-for-byte by the `persons_phone_digits_trgm` index in migration `0002`, a test guards the pair). The search term additionally drops the optional process-wide `PHONE_COUNTRY_CODE` (`phoneNsn`), so national and international forms meet. Change the SQL and the index together.
