import { pgTable, text, timestamp, integer, index } from "drizzle-orm/pg-core";

// Fixed-window rate-limit counters shared across app instances. The default
// express-rate-limit MemoryStore is per-process: under autoscale the real
// limit multiplies by the instance count and resets on every deploy. Keys are
// `<limiter-prefix><user-or-ip>`; rows are upserted atomically per hit and
// expired rows are pruned opportunistically.
export const rateLimitCountersTable = pgTable(
  "rate_limit_counters",
  {
    key: text("key").primaryKey(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull(),
  },
  (table) => [
    // Serves the opportunistic cleanup delete.
    index("rate_limit_counters_window_idx").on(table.windowStart),
  ],
);

export type RateLimitCounter = typeof rateLimitCountersTable.$inferSelect;
