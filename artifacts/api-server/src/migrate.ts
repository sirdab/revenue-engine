import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { pool } from "@workspace/db";
import { logger } from "./lib/logger";

/**
 * Applies the committed SQL migrations (lib/db/drizzle) from the built image,
 * so a self-hosted container can migrate without a pnpm checkout:
 *
 *   node dist/migrate.mjs && node dist/index.mjs
 *
 * Same journal table as `drizzle-kit migrate` (drizzle.__drizzle_migrations),
 * so the two are interchangeable. Several machines may start at once, so the
 * run holds a Postgres advisory lock: the first applies, the rest wait and
 * then find nothing left to do.
 *
 * MIGRATIONS_DIR overrides the folder; the default is `migrations` next to the
 * bundle, where the Dockerfile puts it.
 */
const MIGRATION_LOCK_KEY = 72_111_001;

async function run(): Promise<void> {
  const migrationsFolder =
    process.env.MIGRATIONS_DIR ??
    path.resolve(import.meta.dirname, "migrations");

  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    try {
      await migrate(drizzle(client), { migrationsFolder });
    } finally {
      await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
  logger.info({ migrationsFolder }, "Migrations applied");
}

run()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    logger.error({ err }, "Migration failed");
    await pool.end().catch(() => {});
    process.exit(1);
  });
