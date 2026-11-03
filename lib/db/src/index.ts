import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const poolNum = (value: string | undefined, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Max connections held by THIS process. With several app instances each one
  // opens its own pool, so keep (instances × DB_POOL_MAX) under the Postgres
  // server's max_connections — prefer a pooled/pgBouncer endpoint when unsure.
  max: poolNum(process.env.DB_POOL_MAX, 10),
  // Return idle connections to the server so idle/scaled-down instances don't
  // keep holding slots open.
  idleTimeoutMillis: poolNum(process.env.DB_POOL_IDLE_MS, 30_000),
  // Fail a request quickly when the pool is saturated instead of hanging the
  // request forever waiting for a free connection.
  connectionTimeoutMillis: poolNum(process.env.DB_POOL_CONNECT_TIMEOUT_MS, 10_000),
});

// An error on an IDLE pooled client (e.g. Postgres restarts or drops the
// connection) is emitted here; without a listener node-postgres rethrows it as
// an uncaught exception and crashes the process. Log it and let the pool
// discard/replace the bad client instead.
pool.on("error", (err) => {
  console.error("Unexpected error on idle Postgres client:", err);
});

export const db = drizzle(pool, { schema });

// A SEPARATE, least-privilege connection used ONLY by the Ask AI read-only SQL
// tools. It must point at a Postgres role that is read-only and
// cannot see secret columns (password hashes, reset tokens, the app_settings
// webhook secret) — see scripts/provision-ai-readonly.sql. When
// READONLY_DATABASE_URL is unset the SQL tools degrade to a "not configured"
// message rather than silently falling back to this privileged main pool.
export const readonlyPool = process.env.READONLY_DATABASE_URL
  ? new Pool({
      connectionString: process.env.READONLY_DATABASE_URL,
      // Kept small — the assistant issues at most a handful of concurrent
      // queries and this pool is separate from the app's main one.
      max: poolNum(process.env.READONLY_DB_POOL_MAX, 4),
      idleTimeoutMillis: poolNum(process.env.DB_POOL_IDLE_MS, 30_000),
      connectionTimeoutMillis: poolNum(
        process.env.DB_POOL_CONNECT_TIMEOUT_MS,
        10_000,
      ),
    })
  : undefined;

readonlyPool?.on("error", (err) => {
  console.error("Unexpected error on idle read-only Postgres client:", err);
});

export * from "./schema";
