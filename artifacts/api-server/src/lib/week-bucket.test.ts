import { test } from "node:test";
import assert from "node:assert/strict";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// queries.ts pulls in @workspace/db, whose pool throws at import without a
// DATABASE_URL. Nothing here touches the database.
process.env.DATABASE_URL ??= "postgres://week-bucket-test/unused";

const { bucketDate } = await import("./queries.ts");
const { runWithRegionalSettings, serverDefaults } = await import("./regional-context.ts");

const dialect = new PgDialect();
const render = (weekStart: 0 | 1 | 6, bucket: string) =>
  runWithRegionalSettings({ ...serverDefaults(), weekStart }, () =>
    dialect.sqlToQuery(bucketDate(bucket, sql`x`)).sql,
  );

test("Monday weeks use Postgres's own week truncation", () => {
  assert.equal(render(1, "week"), "date_trunc('week', x)::date");
});

test("Sunday and Saturday weeks shift into a Monday week and back", () => {
  assert.equal(
    render(0, "week"),
    "(date_trunc('week', (x) + 1 * interval '1 day') - 1 * interval '1 day')::date",
  );
  assert.equal(
    render(6, "week"),
    "(date_trunc('week', (x) + 2 * interval '1 day') - 2 * interval '1 day')::date",
  );
});

test("other buckets are untouched by the week start", () => {
  assert.equal(render(0, "month"), "date_trunc($1, x)::date");
});

// The same arithmetic in JS, over a fortnight of days, proves every day lands
// on the right week start: shift forward, truncate to Monday, shift back.
test("the shift lands every day on the chosen week start", () => {
  const mondayTrunc = (d: Date) => {
    const dow = (d.getUTCDay() + 6) % 7; // 0 = Monday
    return new Date(d.getTime() - dow * 86400000);
  };
  for (const weekStart of [0, 1, 6] as const) {
    const shift = (1 - weekStart + 7) % 7;
    for (let i = 0; i < 14; i++) {
      const day = new Date(Date.UTC(2026, 6, 1 + i));
      const start = new Date(mondayTrunc(new Date(day.getTime() + shift * 86400000)).getTime() - shift * 86400000);
      assert.equal(start.getUTCDay(), weekStart, `weekStart ${weekStart}, ${day.toISOString()}`);
      const diff = (day.getTime() - start.getTime()) / 86400000;
      assert.ok(diff >= 0 && diff < 7, "the day is inside its week");
    }
  }
});
