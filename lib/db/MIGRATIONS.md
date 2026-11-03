# Database migrations — how to add or change tables

Deploys apply schema changes with `drizzle-kit migrate`, which runs the
versioned SQL files in `drizzle/` and tracks them in a
`drizzle.__drizzle_migrations` table. It trusts the **migration files**, not the
schema code, so a schema change without a matching migration file never reaches
the database.

## The rule

**Every schema change in `src/schema/*` must ship with a generated migration.**

```bash
# 1. edit the schema (e.g. add src/schema/my-table.ts + export it in index.ts)
# 2. generate the migration files
pnpm --filter @workspace/db run generate
# 3. commit BOTH the schema change and the new drizzle/ files together
```

## A new table must be tenant-scoped

Unless it is genuinely global (like `rate_limit_counters`), a new table needs
all three of these, or one workspace will see another's rows:

1. `tenantId: tenantIdColumn(),` among its columns (from `./tenants`). It
   defaults to the connection's tenant, so application inserts never pass it.
2. `tenantPolicy()` in its extras array — the row-level-security policy.
   drizzle-kit generates the `CREATE POLICY` and `ENABLE ROW LEVEL SECURITY`.
3. A **custom** migration (`pnpm --filter @workspace/db exec drizzle-kit
   generate --custom --name …`) with
   `ALTER TABLE "x" FORCE ROW LEVEL SECURITY;` and a `tenant_id` index —
   drizzle-kit cannot emit FORCE, and without it the table owner (usually the
   app role) bypasses the policy. See `drizzle/0001_rls_force_and_search.sql`.

Any unique index must include `tenant_id` first, so two workspaces can each
have a label called "Hot".

## The app role

Superusers and roles with `BYPASSRLS` ignore row-level security even when it is
forced. The app — locally too — must connect as an ordinary role that owns the
database:

```sql
CREATE ROLE crm_app LOGIN PASSWORD '…' NOSUPERUSER NOBYPASSRLS;
CREATE DATABASE crm OWNER crm_app;
```

## Useful commands

```bash
pnpm --filter @workspace/db run generate   # create migration from schema changes
pnpm --filter @workspace/db run check      # detect schema/migration drift
pnpm --filter @workspace/db run migrate    # apply pending migrations (uses DATABASE_URL)
pnpm --filter @workspace/db run push       # dev only: diff schema -> DB directly
```

`push` does not apply the custom migrations (FORCE RLS, tenant indexes, search
indexes). Use `migrate` for any database you test isolation on.
