import { test } from "node:test";
import assert from "node:assert/strict";

// The status/archived interaction decides which deals a user can see at all, so
// it is asserted against real compiled SQL rather than a mock. Importing the
// router pulls in `lib/auth` -> `@workspace/db`, which refuses to load without a
// DATABASE_URL; nothing here opens a connection (toSQL() only compiles), hence
// the env stub before the dynamic import.
process.env.DATABASE_URL ??= "postgres://deals-where-test/unused";
const { buildDealWhere } = await import("./deals.ts");
const { db, dealsTable } = await import("@workspace/db");

/** The WHERE clause and bound params `buildDealWhere` compiles to. */
function where(params: Parameters<typeof buildDealWhere>[0]) {
  const q = db
    .select({ id: dealsTable.id })
    .from(dealsTable)
    .where(buildDealWhere(params))
    .toSQL();
  return { sql: q.sql.split(/ where /i)[1] ?? "", params: q.params };
}

test("the working views default to open, non-archived deals", () => {
  const { sql, params } = where({ view: "list" });
  assert.match(sql, /"deals"\."archived" = \$1/);
  assert.match(sql, /"deals"\."status" = \$2/);
  assert.deepEqual(params, [false, "open"]);
});

test("an explicit status replaces the open-only default", () => {
  const { params } = where({ status: "won" });
  assert.deepEqual(params, [false, "won"]);
});

test("status=all drops the status filter entirely", () => {
  const { sql, params } = where({ status: "all" });
  assert.doesNotMatch(sql, /"deals"\."status"/);
  assert.deepEqual(params, [false]);
});

// The label says "All", so the one thing that must not silently happen is
// archived (read-only) deals leaking into a working view.
test("status=all still excludes archived deals", () => {
  const { params } = where({ status: "all" });
  assert.deepEqual(params, [false]);
});

test("status=all combines with the archived lens to show every archived deal", () => {
  const { sql, params } = where({ status: "all", archived: true });
  assert.doesNotMatch(sql, /"deals"\."status"/);
  assert.deepEqual(params, [true]);
});

// Regression guard for the removed "Archive" tab: it used to mean
// status IN (won, lost, deleted). `view` must no longer influence status at all.
test("view no longer constrains status", () => {
  assert.deepEqual(where({ view: "list" }).params, where({}).params);
});
