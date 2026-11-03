# Contributing

Thanks for helping. Bug reports, fixes, translations and features are all
welcome. For anything bigger than a small fix, open an issue first so we can
agree on the approach before you spend time on it.

## Getting set up

Follow **Quick start** in the [README](README.md). In short: Node 24, pnpm,
Docker (or your own Postgres), then `pnpm install`, `cp .env.example .env`,
`pnpm db:setup`, `pnpm dev`.

## Before you open a pull request

```bash
pnpm run typecheck
pnpm --filter @workspace/api-server run typecheck:test
pnpm run test
```

CI runs the same checks, plus a full build and the real migrations against a
fresh Postgres.

## How the code is organised

Read [`CLAUDE.md`](CLAUDE.md) before your first change. Despite the name it is
the architecture guide for everyone. Shared vocabulary is in
[`CONCEPTS.md`](CONCEPTS.md) and the database is described in
[`SCHEMA.md`](SCHEMA.md). The rules that matter most:

- **Tenant isolation is enforced by Postgres row-level security.** Query
  through the `db` handle from `@workspace/db` inside a request and you get the
  caller's workspace automatically. Never use `runAsSystem` in signed-in
  request handling. New tables follow the checklist in
  [`lib/db/MIGRATIONS.md`](lib/db/MIGRATIONS.md).
- **The API contract is `lib/api-spec/openapi.yaml`.** Edit it, then run
  `pnpm codegen`. Never hand-edit anything under `generated/`.
- **Schema changes come with a migration**: edit `lib/db/src/schema/*`, run
  `pnpm --filter @workspace/db run generate` and commit the SQL with the schema.
- **UI strings go through i18n** (`artifacts/web/src/lib/i18n`). Add every key
  to both `en.json` and `ar.json`; a parity test fails otherwise. If you can't
  write the Arabic, say so in the PR and leave the English text in `ar.json`.
- Tests use the built-in `node:test` runner and sit next to the code they cover
  (`*.test.ts`).

## Adding a language

Copy `artifacts/web/src/lib/i18n/en.json` to `<code>.json`, translate it and
register the locale in `locales.ts`. See the i18n README in that folder.

## Commit and PR style

Keep pull requests focused on one change and describe what it changes and how
you tested it. The PR template has a short checklist.
