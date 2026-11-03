import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import type { Options, Store, IncrementResponse } from "express-rate-limit";
import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Postgres-backed fixed-window store for express-rate-limit.
//
// The default MemoryStore is per-process: under autoscale the effective limit
// multiplies by the instance count and resets on every deploy. This store
// keeps counters in the shared `rate_limit_counters` table so the limit means
// what it says regardless of how many instances are serving.
//
// One atomic upsert per hit: the window rolls over inside the same statement,
// so concurrent hits across instances never race the reset. If the database
// is unreachable the store FAILS OPEN (allows the request, logs a warning) —
// a rate limiter must degrade to "no limit", never to "no service".
// ---------------------------------------------------------------------------

export class PgRateLimitStore implements Store {
  /** Shared table + distinct prefixes → limiters never collide. */
  readonly prefix: string;
  /** Counters live in a shared database, not per-process memory. */
  readonly localKeys = false;

  private windowMs = 60_000;

  constructor(prefix: string) {
    this.prefix = prefix;
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  async increment(key: string): Promise<IncrementResponse> {
    const fullKey = this.prefix + key;
    const windowMs = this.windowMs;
    try {
      const result = await db.execute<{
        count: number;
        window_start: Date | string;
      }>(sql`
        insert into rate_limit_counters (key, window_start, count)
        values (${fullKey}, now(), 1)
        on conflict (key) do update set
          count = case
            when rate_limit_counters.window_start <= now() - (${windowMs} * interval '1 millisecond')
              then 1
            else rate_limit_counters.count + 1
          end,
          window_start = case
            when rate_limit_counters.window_start <= now() - (${windowMs} * interval '1 millisecond')
              then now()
            else rate_limit_counters.window_start
          end
        returning count, window_start
      `);
      const row = result.rows[0];
      // Opportunistic pruning: ~1% of hits sweep counters idle for 2 windows.
      if (Math.random() < 0.01) {
        void db
          .execute(
            sql`delete from rate_limit_counters where window_start <= now() - (${windowMs * 2} * interval '1 millisecond')`,
          )
          .catch(() => {});
      }
      return {
        totalHits: Number(row.count),
        resetTime: new Date(new Date(row.window_start).getTime() + windowMs),
      };
    } catch (err) {
      logger.warn({ err, key: fullKey }, "rate-limit store unavailable — failing open");
      return { totalHits: 1, resetTime: new Date(Date.now() + windowMs) };
    }
  }

  async decrement(key: string): Promise<void> {
    try {
      await db.execute(
        sql`update rate_limit_counters set count = greatest(count - 1, 0) where key = ${this.prefix + key}`,
      );
    } catch (err) {
      logger.warn({ err }, "rate-limit store decrement failed");
    }
  }

  async resetKey(key: string): Promise<void> {
    try {
      await db.execute(
        sql`delete from rate_limit_counters where key = ${this.prefix + key}`,
      );
    } catch (err) {
      logger.warn({ err }, "rate-limit store resetKey failed");
    }
  }
}
