import { test } from "node:test";
import assert from "node:assert/strict";

// Same trick as compile-deals.test.ts: the pg Pool never connects until a
// query executes, so a dummy URL lets the pure compile paths run without a DB.
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/insights_test";

const { PgDialect } = await import("drizzle-orm/pg-core");
const {
  compileActivitiesGroup,
  compileActivitiesGlobalFilters,
  runActivitiesPerformance,
} = await import("./compile-activities.ts");
const { InsightsQueryError } = await import("./operators.ts");
const { widgetSpecSchema, WIDGET_SPEC_VERSION } = await import(
  "@workspace/insights-spec"
);
const { encodeFilters } = await import("@workspace/deals-filter");
import type { DealsFieldCatalog, InsightsFieldDef } from "./fields.ts";

const dialect = new PgDialect();
const render = (q: import("drizzle-orm").SQL) => dialect.sqlToQuery(q);

function catalogWith(...defs: InsightsFieldDef[]): DealsFieldCatalog {
  return {
    fields: defs,
    customByRef: new Map(defs.map((d) => [d.key, d])),
  };
}

const QUALIFICATION: InsightsFieldDef = {
  key: "cf:qualification",
  label: "Qualification",
  type: "enum",
  kind: "custom",
  filterable: true,
  groupable: true,
  measurable: false,
  customKey: "qualification",
};

const BASE_SPEC = {
  version: WIDGET_SPEC_VERSION,
  scope: "activities",
  reportType: "performance",
  measure: { field: "id", agg: "count" },
  viewBy: { field: "type" },
  filters: { combinator: "and", conditions: [] },
} as const;

test("activity native conditions compile (type enum, done boolean, subject text)", () => {
  const { where, needsOrgJoin } = compileActivitiesGroup({
    combinator: "and",
    conditions: [
      { field: "type", operator: "is", value: "call" },
      { field: "done", operator: "is", value: false },
      { field: "subject", operator: "contains", value: "intro" },
    ],
  });
  assert.ok(where);
  assert.equal(needsOrgJoin, false);
  const { sql, params } = render(where);
  assert.match(sql, /"type"::text = /);
  assert.match(sql, /"done" = /);
  assert.match(sql, /"subject" ilike /);
  assert.deepEqual(params, ["call", false, "%intro%"]);
});

test("not_contains compiles NULL-inclusive on text fields", () => {
  const { where } = compileActivitiesGroup({
    combinator: "and",
    conditions: [{ field: "subject", operator: "not_contains", value: "spam" }],
  });
  assert.ok(where);
  const { sql, params } = render(where);
  assert.match(sql, /"subject" is null or .*"subject" not ilike /);
  assert.deepEqual(params, ["%spam%"]);
});

test("invalid activity type values are rejected", () => {
  assert.throws(
    () =>
      compileActivitiesGroup({
        combinator: "and",
        conditions: [{ field: "type", operator: "is", value: "carrier-pigeon" }],
      }),
    InsightsQueryError,
  );
});

test("date fields: dueDate compares the raw date column; timestamps convert to the app time zone", () => {
  const { where } = compileActivitiesGroup({
    combinator: "and",
    conditions: [
      { field: "dueDate", operator: "between", value: ["2026-07-01", "2026-07-31"] },
      { field: "createdAt", operator: "gt", value: "2026-01-01" },
    ],
  });
  assert.ok(where);
  const { sql } = render(where);
  assert.match(sql, /"due_date" between /);
  assert.doesNotMatch(sql, /"due_date"[^b]*AT TIME ZONE/);
  assert.match(sql, /"add_time" AT TIME ZONE 'UTC'/);
});

test("organization conditions flag the join; cf: refs and unknown fields are rejected", () => {
  const { where, needsOrgJoin } = compileActivitiesGroup({
    combinator: "and",
    conditions: [{ field: "organization", operator: "contains", value: "Acme" }],
  });
  assert.ok(where);
  assert.equal(needsOrgJoin, true);

  for (const field of ["cf:qualification", "seatCount", "dropTables"]) {
    assert.throws(
      () =>
        compileActivitiesGroup({
          combinator: "and",
          conditions: [{ field, operator: "is", value: "x" }],
        }),
      InsightsQueryError,
      field,
    );
  }
});

test("board owner + date range apply to the activity itself", () => {
  const spec = widgetSpecSchema.parse(BASE_SPEC);
  const { conditions, applied } = compileActivitiesGlobalFilters(
    {
      ownerIds: [7],
      dateRange: { from: "2026-06-01", to: "2026-06-30", basis: "activityDoneAt" },
    },
    spec,
    catalogWith(),
  );
  assert.equal(conditions.length, 3);
  const owner = render(conditions[0]);
  assert.match(owner.sql, /"activities"\."owner_id" in /);
  assert.deepEqual(owner.params, [7]);
  const from = render(conditions[1]);
  assert.match(from.sql, /"marked_as_done_time" AT TIME ZONE 'UTC'/);
  assert.equal(applied.length, 2);
});

test("deal-shaped board filters compile to an EXISTS on the linked deal", () => {
  const spec = widgetSpecSchema.parse(BASE_SPEC);
  const { conditions, applied } = compileActivitiesGlobalFilters(
    {
      statuses: ["won", "deleted"], // deleted is not a board status; dropped
      pipelineIds: [2],
      qualification: "qualified",
    },
    spec,
    catalogWith(QUALIFICATION),
  );
  // pipeline + status + qualification fold into ONE exists condition.
  assert.equal(conditions.length, 1);
  const { sql, params } = render(conditions[0]);
  assert.match(sql, /exists \(select 1 from "deals"/);
  assert.match(sql, /"deals"\."id" = "activities"\."deal_id"/);
  assert.match(sql, /"deals"\."archived" = false/);
  assert.match(sql, /"custom_fields" ->> 'qualification'/);
  assert.deepEqual(params, [2, "won", "qualified"]);
  assert.equal(applied.length, 3);
});

test("the board Add-filter group (deals vocabulary) rides the linked-deal EXISTS", () => {
  const spec = widgetSpecSchema.parse(BASE_SPEC);
  const encoded = encodeFilters({
    combinator: "and",
    conditions: [{ field: "value", operator: "gt", value: 5000 }],
  });
  const { conditions, applied } = compileActivitiesGlobalFilters(
    { filters: encoded },
    spec,
    catalogWith(),
  );
  assert.equal(conditions.length, 1);
  const { sql, params } = render(conditions[0]);
  assert.match(sql, /exists \(select 1 from "deals"/);
  assert.match(sql, /"deals"\."value" > /);
  assert.deepEqual(params, [5000]);
  assert.ok(applied.some((a) => a.includes("via linked deal")));
});

test("unsupported date bases fail loudly for activities", () => {
  const spec = widgetSpecSchema.parse(BASE_SPEC);
  assert.throws(
    () =>
      compileActivitiesGlobalFilters(
        { dateRange: { from: "2026-01-01", basis: "wonAt" } },
        spec,
        catalogWith(),
      ),
    InsightsQueryError,
  );
});

test("non-count aggregations and bad date bases are rejected before any DB work", async () => {
  await assert.rejects(
    runActivitiesPerformance(
      widgetSpecSchema.parse({
        ...BASE_SPEC,
        measure: { field: "id", agg: "sum" },
      }),
      null,
    ),
    InsightsQueryError,
  );
  await assert.rejects(
    runActivitiesPerformance(
      widgetSpecSchema.parse({ ...BASE_SPEC, dateBasis: "wonAt" }),
      null,
    ),
    InsightsQueryError,
  );
});
