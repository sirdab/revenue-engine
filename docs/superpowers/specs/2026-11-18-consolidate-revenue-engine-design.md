# Consolidate crm-1 and revenue-engine into one open-source CRM

Date: 2026-11-18
Status: draft, awaiting approval

## Why

Sirdab has two private repos for what is meant to be one open-source CRM:
`sirdab/crm-1` (this repo) and `sirdab/revenue-engine` (`../revenue-engine`).
They split on release day (2026-11-03) and have drifted since. Two copies means
every fix and feature lands twice or diverges. We want exactly one repo and one
product before either goes public.

Neither has a live deployment with real data, so nothing has to be migrated.
crm-1 is the cleaner of the two and becomes the base.

## How the two repos relate (findings)

- revenue-engine's first commit `a70a65b` is effectively the common ancestor.
  189 of crm-1's 286 frontend files are byte-identical to it.
- **crm-1 since then** added: multi-tenancy (Postgres RLS, self-serve sign-up,
  workspaces), the Ask AI assistant, per-workspace Slack settings, a
  configurable `APP_TIMEZONE` and `PHONE_COUNTRY_CODE`, a Fly.io deploy
  (`fly.toml`, `deploy.yml`, bundled `migrate`), `pnpm dev` with root `.env`
  loading, `.claude/` skills, issue/PR templates, `CONCEPTS.md`, `DEPLOY.md`.
  It removed the Pipedrive-specific schema (`leads`, `files`, `sync_state`,
  `pipedrive_id`/`pipedrive_data` columns). Licence MIT.
- **revenue-engine since then** has one PR, `38caa6e` "Move the UI to Sirdab
  One" (205 files: 177 modified, 28 `components/ui/*` deleted, 1 added). It
  installs `@sirdab/one` (MIT design system, github.com/sirdab/one) from a
  GitHub Release tarball (`v0.1.0-alpha.1`), adds `radix-ui@1.8.1`, bumps React
  to 19.2.4 (One requires `^19.2.4`), and replaces Tailwind's default palette
  with One's semantic tokens. It also still carries the Pipedrive one-off
  import and live sync, a hardcoded `Asia/Riyadh` timezone, generic `SMTP_*`
  mail settings, and MinIO + Mailpit in Docker Compose. Licence AGPL-3.0.
- Trial run (in a scratch clone): applying `a70a65b..38caa6e` to crm-1 with
  `artifacts/login/` → `artifacts/web/` and `git apply --3way` merges cleanly
  in all but **27 files (32 conflict hunks, mostly one each)**. One file,
  `components/ui/sheet.test.ts`, must be excluded from the patch and deleted by
  hand (crm-1 edited it; One deletes it), or the whole 3-way apply aborts.
- After that apply, **148 default-palette classes remain in 36 files** (crm-1's
  2,326 drop to 148). These render with no colour under One. They are mostly in
  crm-1-only code: `shared/list-view.tsx` (18), `settings/slack-settings.tsx`
  (11), `settings/automation-wizard.tsx` (11), `index.css` (18),
  `shared/kanban-sort.tsx`, `settings/workspace-settings.tsx`,
  `error-boundary.tsx`, `pages/signup.tsx`, `layout/brand-mark.tsx`,
  `shared/search-input.tsx`. revenue-engine's own HEAD still has 21 such
  classes in 17 files, so "zero" is not One's own bar; see Verification.
- No crm-1 code imports any of the 28 `ui/*` modules One deletes.

## Goals

1. One repo, `sirdab/revenue-engine`, containing crm-1's code and features
   with revenue-engine's Sirdab One UI.
2. The product is named **Sirdab Revenue Engine** everywhere a person sees it.
3. Licence is **MIT** (copyright Sirdab).
4. `docker compose up -d` gives Postgres, MinIO (file attachments) and Mailpit
   (outgoing email) on any machine, including Apple silicon, for `pnpm dev`;
   the full app container (`--profile app`, amd64-only) uses the same services.
5. A workspace admin can import a Pipedrive export of organizations, people
   and deals through the existing CSV import with no manual column mapping.
6. Both repos' histories stay reachable. `sirdab/crm-1` is archived with a
   pointer to the new home.

## Non-goals

- Pipedrive **live** sync (`migrations/pipedrive-api-sync`, its GitHub
  workflow, `sync_state`). Dropped.
- Restoring revenue-engine's Pipedrive schema (`leads`, `files`, `sync_state`,
  `pipedrive_id`/`pipedrive_data` columns). Dropped.
- Upgrading `@sirdab/one` past `v0.1.0-alpha.1`, or any visual redesign beyond
  what One's tokens give.
- Any new product feature, refactor, or change to multi-tenancy, auth, or the
  API contract beyond renames listed here.
- Upgrading a database: there is none to keep.

## Anti-goals (would make this a failure even if it builds)

- A screen that renders colourless or broken under One (the silent-palette
  trap).
- Weakening tenant isolation in any way (e.g. a Pipedrive importer that writes
  with `runAsSystem` or raw `pg` outside the tenant-scoped `db`).
- Losing a crm-1 fix while resolving conflicts (crm-1's behaviour wins; One's
  styling wins).
- Force-pushing over `sirdab/revenue-engine` main, or losing PR #1 from its
  history.

## Approaches considered

1. **Replay revenue-engine's One UI PR onto crm-1 (chosen).** 3-way apply
   `a70a65b..38caa6e` onto a branch of crm-1, resolve the 27 conflicted files,
   restyle the leftovers, then port the remaining pieces. Smallest, most
   contained diff; crm-1's behaviour is preserved by construction.
2. Copy revenue-engine's whole frontend over crm-1's and re-port crm-1's ~97
   frontend changes. Rejected: more re-porting, and lost fixes would be silent.
3. Port crm-1's backend into revenue-engine. Rejected: multi-tenancy touches
   every table, query and migration; the riskiest diff, and crm-1 is the
   cleaner base.

## Design

Work happens on a branch `consolidate/revenue-engine` in this repo (crm-1),
cut from `main`. Nothing touches either GitHub repo until the last step.

### 1. Sirdab One UI

- Fetch revenue-engine into this repo, then
  `git diff a70a65b 38caa6e -- . ':!pnpm-lock.yaml'`, rewrite
  `artifacts/login/` → `artifacts/web/`, and
  `git apply --3way --exclude=artifacts/web/src/components/ui/sheet.test.ts`.
  Delete `sheet.test.ts` (and `sheet-variants.ts` is already in the patch's
  deletions). Regenerate `pnpm-lock.yaml` with `pnpm install`.
- Conflict rule: **crm-1's behaviour and data flow win; One's markup, classes
  and component imports win.** For the docs files in the conflict list
  (`README.md`, `CLAUDE.md`, `CONTRIBUTING.md`), see section 5 instead.
- `pnpm-workspace.yaml`: React and React DOM to exactly `19.2.4` with One's
  comment. Keep crm-1's other catalog entries and overrides.
- Restyle every remaining default-palette class in crm-1-only code onto One's
  semantic tokens (`text-muted-foreground`, `text-subtle`, `border-border`,
  `bg-card`, `bg-muted`, `bg-gray-alpha-*`, `bg-primary`, `text-brand`,
  `bg-brand-subtle`, status tones `destructive|warning|success|attention` with
  `-subtle`/`-glyph`). Read One's `TOKENS.md` and `COLORS.md` first. Follow the
  patterns revenue-engine used for equivalent screens.
- Brand assets from revenue-engine: `public/sirdab-favicon.{png,svg}`,
  `public/opengraph.jpg`, `public/link-preview.png`,
  `src/assets/brand/sirdab-logo.webp`, `sirdab-favicon.png`, and
  `layout/topbar-icon.ts` (comes with the patch). crm-1's
  `layout/brand-mark.tsx` shows the Sirdab mark.

### 2. Pipedrive import

**Decided: Pipedrive presets in the existing in-app CSV import.** A workspace
admin exports organizations, people or deals from Pipedrive and drops the file
into Settings → Import; the columns map themselves.

- The mechanism already exists: `autoMapHeaders` in
  `artifacts/web/src/lib/import-spec.ts` matches each header against a
  field's `key`, `label` and `aliases`. The work is adding Pipedrive's export
  header names to `aliases` on the organization, person and deal field specs,
  including any entity-prefixed forms Pipedrive's exports use (e.g.
  `Deal - Title`), and normalising those prefixes in one place if aliases
  alone get unwieldy.
- Source for the header names: the column names revenue-engine's
  `migrations/pipedrive/import.js` reads from real Pipedrive exports (e.g.
  `Expected close date`, `Currency of Value`, `Email - Work`, `Labels`), checked
  against Pipedrive's export docs. Build a small fixture CSV per entity from
  those headers.
- No server change: the import stays create-only, tenant-scoped and
  admin-only, exactly as today. Users, activities, notes and files are not
  imported (non-goal).
- Nothing from `import.js` is reused as code (it hardcodes a local
  `~/Downloads` path and file names, and computes pipeline/stage ids as
  offsets, which RLS makes unsafe).

### 3. Docker Compose: MinIO + Mailpit

- Keep crm-1's `db` service (with `docker/postgres-init.sql`, the non-superuser
  app role) and its `app` profile.
- Add from revenue-engine: `minio` (S3 API + console on 9001), a one-shot `mc`
  service that creates the bucket, and `mailpit` (SMTP on 1025, UI on 8025).
  Pin image tags instead of `:latest`.
- `db`, `minio`, `mc` and `mailpit` start by default (no profile), so
  `docker compose up -d` serves `pnpm dev` on any machine. `.env.example`
  defaults point `S3_*` and `SMTP_*` at them.
- Wire the `app` service's `S3_*` and SMTP variables to them by default so
  `docker compose --profile app up` sends mail to Mailpit and stores files in
  MinIO with no edits to `.env`.
- *Call made during review:* the app image stays **linux/amd64-only**. Adding
  the linux-arm64 native binaries back would break the CLAUDE.md platform rule
  and change the lockfile and Dockerfile, which is out of scope. Mac users run
  the services in Compose and the app with `pnpm dev`, as crm-1's README
  already says.
- **Mail settings become generic SMTP** so Mailpit (no TLS, no auth) works:
  replace crm-1's `AWS_SES_SMTP_ENDPOINT/USER/PASSWORD` + `AWS_SMTP_PORT` with
  revenue-engine's `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`,
  `SMTP_REQUIRE_TLS` (default true), with auth optional. Take revenue-engine's
  `mailer.ts` transport logic; keep crm-1's error types and call sites. Update
  `.env.example`, `fly.toml` comments, `DEPLOY.md`, `CLAUDE.md`.

### 4. Rebrand and licence

- Product name "Sirdab Revenue Engine" (short "Revenue Engine") in: README,
  CLAUDE.md, CONTRIBUTING, SECURITY, DEPLOY, `index.html` title and meta,
  i18n strings (en + ar) that say "CRM" as a product name, the `APP_NAME` and
  `MAIL_FROM` defaults, the OpenAPI `info.title` (then run codegen so the
  generated headers update), the root `package.json` `name`, and the GitHub
  repo description.
- `LICENSE`: MIT, "Copyright (c) 2026 Sirdab". Every `package.json` `license`
  field: `MIT`. Remove AGPL mentions everywhere.
- **Trademark carve-out (decided):** a short note at the end of `LICENSE` and
  a "Trademarks" section in the README: the code is MIT, but the Sirdab name,
  the Sirdab and Revenue Engine logos, favicons and Open Graph images are
  Sirdab trademarks, are not licensed under MIT, and must be removed or
  replaced in forks that are distributed or hosted. Keep it plain and brief.
- Internal identifiers (`@workspace/*` package names, `artifacts/web`, the DB
  role/database names in compose, `fly.toml` `app`) are the builder's call;
  keep them unless renaming is free.

### 5. Docs

crm-1's docs are the base (they describe the code that ships). Merge in from
revenue-engine:
- README: its Features list (minus Pipedrive sync) and the One mention.
- CLAUDE.md: its "Sirdab One" frontend paragraph (tokens only, `index.css`
  import order, tarball install and upgrade, React pin reason), replacing
  crm-1's "Radix/shadcn UI" and "React pinned to 19.1.0" lines. Update the
  repo layout table and mail env vars.
- Drop: references to the Pipedrive sync, `artifacts/login`, AGPL, hardcoded
  Riyadh timezone (`APP_TIMEZONE` stays; Sirdab sets `Asia/Riyadh` in its own
  deployment).

### 6. CI

Keep crm-1's `ci.yml` and `deploy.yml` (deploy is off unless the repo variable
`FLY_APP` is set). Drop revenue-engine's `pipedrive-sync.yml`. Keep crm-1's
issue and PR templates.

### 7. Landing in sirdab/revenue-engine (outward-facing; confirm each step)

0. *Call made during review:* both repos are treated as frozen until landing.
   Guard: abort unless `sirdab/revenue-engine` `main` is still `38caa6e`
   (`-s ours` below would silently discard any newer change there). If
   crm-1 `main` has moved since the branch was cut, merge it into the branch
   first.
1. On the finished branch, record revenue-engine's history without taking any
   of its files:
   `git merge --allow-unrelated-histories -s ours revenue-engine/main`.
   The result's tree is the consolidated tree; its parents are crm-1's history
   and revenue-engine's `main` (with PR #1).
2. Push the branch to `sirdab/revenue-engine` and open a PR into `main`. It
   fast-forwards cleanly because `main` is a parent. No force-push.
3. After merge: update the revenue-engine repo description; add a README
   pointer in `sirdab/crm-1` to the new home, then archive `sirdab/crm-1`.

## Verification

- `pnpm run typecheck`, `pnpm run test`, `pnpm run build` pass.
- Default-palette scan (`(text|bg|border|ring|…)-(slate|gray|…|rose)-NNN`)
  over `artifacts/web/src`: no hits other than `gray-*`. One's stylesheet
  defines a full `gray-*` ramp (50–950), so `gray-*` renders correctly; all 21
  leftovers in revenue-engine's HEAD are `gray-*`. Every other palette
  (`slate`, `teal`, `red`, …) is removed by One and must be restyled.
- No `<<<<<<<` markers anywhere; `grep -ri agpl` and `grep -ri pipedrive-api-sync`
  return nothing outside history.
- Drive the app (`/verify`): sign-up creates a workspace; board, deal detail,
  contacts, activities, insights, settings (incl. Slack and Workspace), Ask AI
  page, sign-in / forgot / reset password, each in light and dark and in Arabic
  (RTL). A second workspace cannot see the first's data.
- With `docker compose up -d` + `pnpm dev` (on the Mac): a password-reset
  email appears in Mailpit; a file attached to a deal lands in MinIO and
  downloads back. `docker compose --profile app up --build` is checked the
  same way on an amd64 machine or in CI.
- Pipedrive import: a `node:test` case per entity asserts `autoMapHeaders`
  maps every relevant column of the Pipedrive fixture headers; in the running
  app, importing each fixture into a fresh workspace creates the expected
  organizations, people and deals with no manual mapping.

## Left to the builder

- Exact token chosen for each restyled class, following One's docs.
- Task order and commit granularity on the branch.
- Image tags for MinIO / Mailpit.
- Whether to rename internal identifiers (see 4).

- Exact Pipedrive header aliases and whether prefix normalisation is needed.

## Decisions log

- Base: crm-1. Approach 1 (replay the One UI PR). No data to migrate.
- Carry over: Sirdab One UI, Pipedrive import (in-app CSV presets),
  MinIO + Mailpit. Dropped: Pipedrive live sync.
- Licence MIT with a trademark carve-out for the Sirdab brand.
- Name "Sirdab Revenue Engine", home `sirdab/revenue-engine`; `sirdab/crm-1`
  archived.
- Calls made during review (correct if wrong): app image stays amd64-only;
  both repos frozen until landing, with a guard; generic `SMTP_*` env names
  replace `AWS_SES_*`; `gray-*` classes allowed under One.
