# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) and other coding agents when working with code in this repository.

## What this is

Sirdab Revenue Engine: an open-source, self-hosted sales CRM in the spirit of Pipedrive (pipelines and a Kanban board, deals, people, organizations, activities, notes, files, automations, assignment rules, insights, audit history). English and Arabic (RTL). It is a **pnpm-workspace monorepo**; in production the API server and the built frontend are served same-origin under `/api`. Several instances can serve at once, so treat all state as multi-instance (no in-process state that must be shared).

## Monorepo layout

`lib/*` are shared libraries, `artifacts/*` are deployable apps. All are `@workspace/*` and consume each other via `workspace:*`.

| Package | Name | Role |
|---|---|---|
| `lib/db` | `@workspace/db` | **Source of truth for the database**: Drizzle ORM schema + Postgres `pool`/`db` client + migrations. |
| `lib/api-spec` | `@workspace/api-spec` | **Source of truth for the API contract**: `openapi.yaml` + Orval codegen config. Generates the two packages below. |
| `lib/api-zod` | `@workspace/api-zod` | **Generated** Zod request/response schemas + TS types (do not hand-edit `generated/`). |
| `lib/api-client-react` | `@workspace/api-client-react` | **Generated** React Query hooks + a hand-written `custom-fetch.ts` mutator. |
| `lib/deals-filter` | `@workspace/deals-filter` | Shared filter DSL (Zod), used by **both** the server (compiles to parameterized SQL) and the client (condition builder + URL encoding). |
| `lib/insights-spec` | `@workspace/insights-spec` | The insights widget spec, shared by server and client. |
| `lib/automation-placeholders` | `@workspace/automation-placeholders` | Automation message placeholders (`{{deal.title}}`), shared by server and client. |
| `artifacts/api-server` | `@workspace/api-server` | Express 5 backend, esbuild-bundled. |
| `artifacts/login` | `@workspace/login` | The React frontend (despite the name): Vite, wouter routing, Tailwind v4, Radix/shadcn UI, React Query. |
| `scripts` | `@workspace/scripts` | One-off tsx scripts and the i18n tooling. |
| `migrations/` | — | Pipedrive CSV import and the Pipedrive API sync (plain Node scripts). |

## Commands

Run from the repo root unless noted.

```bash
pnpm run typecheck                 # libs (tsc --build) + per-package typecheck: the primary gate
pnpm run test                      # node --test suites (api-server, login); needs Node >= 23.6
pnpm run build                     # typecheck, then build all packages

pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/api-server run typecheck:test   # the *.test.ts files
pnpm --filter @workspace/login run typecheck

pnpm --filter @workspace/api-server run dev        # build + start (no watch mode)
pnpm --filter @workspace/api-server run bootstrap  # idempotent: ensure one admin from BOOTSTRAP_ADMIN_*
pnpm --filter @workspace/api-server run seed       # WIPES every table, loads demo data

pnpm --filter @workspace/login run dev             # requires PORT and BASE_PATH, or it throws

pnpm --filter @workspace/api-spec run codegen      # after editing openapi.yaml

pnpm --filter @workspace/db run generate           # schema change -> drizzle/NNNN_*.sql; commit with the schema
pnpm --filter @workspace/db run migrate            # apply migrations
pnpm --filter @workspace/db run push               # local-dev shortcut: push schema directly (no files)
```

Tests use the built-in `node:test` runner via tsx: `*.test.ts` files live next to the code they cover. Strict TypeScript is the broad gate; the suites cover the intricate pure logic.

## The two source-of-truth chains (most important thing to understand)

1. **API contract**: edit `lib/api-spec/openapi.yaml` → run `codegen` → regenerates Zod schemas (`api-zod`) and React Query hooks (`api-client-react`). The server validates requests with the generated Zod schemas and the client calls the generated hooks. **Never hand-edit anything under a `generated/` directory.** Orval coerces query/param types and emits dates/bigints (`useDates`, `useBigInt`). A few routes are deliberately spec-less (multipart file upload in `routes/files.ts`).

2. **Database**: edit the Drizzle schema under `lib/db/src/schema/*` → `pnpm --filter @workspace/db run generate` → commit the schema and the generated `drizzle/` files together (see `lib/db/MIGRATIONS.md`). `SCHEMA.md` documents the schema for data mapping/import; note its field-naming gotchas (the org link is `organizationId` on persons/deals but **`orgId`** on activities/notes; the note author is **`userId`**, not `ownerId`; `pipelines.id`/`stages.id` are assigned, not auto-generated).

DB columns are `snake_case`; the API/app uses `camelCase`.

## Backend architecture

- `src/index.ts` → `src/app.ts` (Express setup: pino-http logging, CORS, cookie-parser signed with `SESSION_SECRET`, mounts the router at `/api`, serves the built frontend with an SPA fallback) → `src/routes/index.ts`.
- `routes/index.ts` mounts the public routers (`health`, `auth`, `webhooks`) first, then applies `requireAuth` globally: **every router added after that line is authenticated**. Admin-only routes additionally use `requireAdmin`.
- `src/lib/` holds the services: `auth.ts` (sessions, password hashing, reset tokens), `queries.ts` (deal/activity queries and the filter-to-SQL compiler), `change-events.ts` (audit log), `automations.ts` + `automation-admin.ts` (the automations engine and its validation), `assignment.ts` + `assignment-rules.ts`, `deal-fields.ts` (custom-field registry), `notifications.ts` (one `notify()` fanning out to in-app, email and Slack), `crm-files.ts` + `object-storage.ts` (attachments in S3-compatible storage), `insights/` (dashboard compilers), `mailer.ts`, `slack.ts`, `rate-limit.ts`.
- **Auth**: scrypt password hashing; the session is a signed cookie `sid` carrying `${userId}.${passwordChangedEpoch}`. Baking the password-change timestamp into the cookie lets a password reset/change instantly revoke all older sessions. Cookie `SameSite` is `lax` in production (same-origin) but `none; Secure` in dev.
- **Automations and assignment rules run inline** inside the deal-write transaction, so their effects commit atomically with the write. Network side effects (webhooks, Slack) are collected during the transaction and fired only after it commits.
- **Build**: `build.mjs` runs esbuild to bundle `index`/`seed`/`bootstrap` as ESM, externalizing native modules (see the `external` list).

## Frontend architecture

- `src/App.tsx` is the router: `wouter` `<Switch>`, wrapped in `QueryClientProvider` + `AuthProvider`. Most routes are gated by `<AuthGuard>` (some `adminOnly`) and wrapped in `<AppLayout>`.
- Data fetching goes through the **generated** `@workspace/api-client-react` hooks; auth is cookie-based, so the browser attaches the session automatically.
- UI is built on **Sirdab One** (`@sirdab/one`, github.com/sirdab/one), Sirdab's MIT design system on shadcn/Radix: components, semantic tokens (light/dark), fonts, Arabic/RTL. It is installed from a GitHub Release tarball URL in `artifacts/login/package.json` (to upgrade, change the URL; check the sha256 in the release notes). `src/components/ui/*` mostly re-export One's components (`export * from "@sirdab/one/components/<name>"`), so call sites import from `@/components/ui/...`; the few app-specific primitives (date/time pickers, async/multi comboboxes, emoji picker) stay local and are styled with One's tokens. Read One's `TOKENS.md` and `COLORS.md` before painting anything.
- **Colours are semantic tokens only.** `index.css` loads One's precompiled stylesheet, then this app's Tailwind build, then One's Tailwind bridge, which REPLACES Tailwind's default palette: `text-slate-500` or `bg-teal-600` silently produce nothing. Use `text-foreground` / `text-muted-foreground` / `text-subtle`, `border-border`, `bg-card` / `bg-surface-whisper` / `bg-muted`, alpha washes (`bg-gray-alpha-50`) for hovers, `bg-primary` (ink) for THE action, `text-brand` / `bg-brand-subtle` for brand accents, and the status tones (`destructive`, `warning`, `success`, `attention`, each with `-subtle` and `-glyph`). The import order in `index.css` matters (see its comment).
- React is pinned to 19.2.4 because One requires `^19.2.4`.
- Path alias: `@` → `src`.
- i18n: English and Arabic message catalogs under `src/lib/i18n`; Arabic renders RTL. See `scripts/i18n/README.md`.
- The frontend reads `PORT` and `BASE_PATH` from env at config time and **throws if either is missing**.

## Environment variables

All documented in `.env.example`. Required: `DATABASE_URL`, `SESSION_SECRET` (api-server), `PORT` + `BASE_PATH` (frontend dev/build). Optional, each switching itself off when unset: S3-compatible storage for attachments (`S3_*`), SMTP email (`SMTP_*`, `MAIL_FROM`), Slack (`SLACK_BOT_TOKEN` or `SLACK_WEBHOOK_URL`, `SLACK_ANNOUNCE_CHANNEL`; `SLACK_STUB=1` captures sends in memory for local dev), Sentry (`SENTRY_DSN`, plus `VITE_SENTRY_DSN` as a build arg), `WEBHOOK_DEFAULT_OWNER_EMAIL`, and `PIPEDRIVE_API_TOKEN` for the Pipedrive sync.

## Workspace conventions & gotchas

- **pnpm only.** The root `preinstall` hook deletes `package-lock.json`/`yarn.lock` and refuses non-pnpm installs.
- **Supply-chain guard**: `pnpm-workspace.yaml` sets `minimumReleaseAge: 1440` (packages must be at least a day old before install). Do not disable it; use `minimumReleaseAgeExclude` only for trusted scopes.
- **Dependency versions** are centralized in the `catalog:` block of `pnpm-workspace.yaml`; reference `catalog:` in package.json rather than pinning.
- The esbuild/rollup/lightningcss native-binary `overrides` strip all platforms except linux-x64 (the Docker image) and darwin-arm64 (Apple-silicon dev).
- TypeScript is strict (`strictNullChecks`, `noImplicitAny`, `noImplicitReturns`, `noFallthroughCasesInSwitch`); `moduleResolution: bundler` with a custom `workspace` export condition.
- Dates: the app's business timezone is `Asia/Riyadh` (`APP_TZ` in `api-server/src/lib/queries.ts`, `lib/team-dates.ts`, and the deals-filter evaluator); date filters and buckets compare calendar days in that zone.
- Licensed AGPL-3.0-only. New source files need no per-file header.
