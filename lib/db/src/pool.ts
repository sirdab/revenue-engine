import pg from "pg";

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
  // Max connections held by THIS process. With multiple machines each instance
  // opens its own pool, so keep (instances × DB_POOL_MAX) under the Postgres
  // server's max_connections. Do NOT put a transaction-mode pooler (PgBouncer's
  // usual setting) in front to stretch that: the tenant binding in
  // tenant-context.ts is a session setting on the connection, and transaction
  // pooling would run the next statement on some other tenant's connection.
  // A session-mode pooler, or the database's direct endpoint, is safe.
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
