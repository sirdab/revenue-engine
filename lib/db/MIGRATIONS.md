# Database migrations — how to add or change tables

Deploys apply schema changes with `drizzle-kit migrate`, which runs the versioned SQL files in `drizzle/` and tracks them in a
`drizzle.__drizzle_migrations` table. It trusts the **migration files**, not the
schema code. So a schema change without a matching migration file makes the deploy
think the table/column shouldn't exist → it generates a destructive `DROP`.

## The rule

**Every schema change in `src/schema/*` must ship with a generated migration.**

```bash
# 1. edit the schema (e.g. add src/schema/my-table.ts + export it in index.ts)
# 2. generate the migration files
pnpm --filter @workspace/db run generate
# 3. commit BOTH the schema change and the new drizzle/ files together
git add lib/db/src/schema lib/db/drizzle
git commit -m "Add my_table"
```

`generate` creates `drizzle/NNNN_*.sql` plus updates `drizzle/meta/`. Deploy →
migrate applies it cleanly, no destructive diff.

## Local dev shortcut

For fast local iteration you can skip migration files and push the schema straight
to your dev DB:

```bash
pnpm --filter @workspace/db run push
```

But **before deploying**, always `generate` + commit the migration — push does not
create the files a deploy's `migrate` needs.

## Useful commands

```bash
pnpm --filter @workspace/db run generate   # create migration from schema changes
pnpm --filter @workspace/db run check      # detect schema/migration drift
pnpm --filter @workspace/db run migrate    # apply pending migrations (uses DATABASE_URL)
pnpm --filter @workspace/db run push       # dev only: diff schema -> DB directly
```

## Important: a pre-existing database needs a baseline

`drizzle-kit migrate` only skips a migration if it's recorded in
`drizzle.__drizzle_migrations`. A database that already has the tables (e.g. one
populated by `push` or a data import) but **no** migration-tracking table will make
migrate try to `CREATE TABLE` things that already exist → it fails.

To "baseline" such a DB (mark migration `0000` as already applied *without*
running its SQL), insert its journal entry into `drizzle.__drizzle_migrations`
once. Do this before pointing a deploy's `migrate` at a pre-populated database.
