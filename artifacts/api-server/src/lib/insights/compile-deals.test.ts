import { test } from "node:test";
import assert from "node:assert/strict";

// compile-deals reuses the deals-list condition compiler (queries.ts), which
// transitively imports the pg Pool. The pool never connects until a query
// executes, so a dummy URL lets the pure compile paths run without a DB.
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/insights_test";

const { PgDialect } = await import("drizzle-orm/pg-core");
const {
  compileExtendedGroup,
  compileGlobalFilters,
  resolveSortTarget,
  InsightsQueryError,
} = await import("./compile-deals.ts");
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

const SQM: InsightsFieldDef = {
  key: "cf:first_inbound_expected_number_of_sqm_pal",
  label: "Expected sqm/pallets",
  type: "double",
  kind: "custom",
  filterable: true,
  groupable: true,
  measurable: true,
  customKey: "first_inbound_expected_number_of_sqm_pal",
};

const IS_ECOMMERCE: InsightsFieldDef = {
  key: "cf:is_ecommerce",
  label: "Is e-commerce",
  type: "boolean",
  kind: "custom",
  filterable: true,
  groupable: true,
  measurable: false,
  customKey: "is_ecommerce",
};

test("base-DSL native conditions compile (status)", () => {
  const { where, needsOrgJoin } = compileExtendedGroup(
    {
      combinator: "and",
      conditions: [{ field: "status", operator: "is", value: "won" }],
    },
    catalogWith(),
  );
  assert.ok(where);
  assert.equal(needsOrgJoin, false);
  const { sql, params } = render(where);
  assert.match(sql, /"status"::text = /);
  assert.deepEqual(params, ["won"]);
});

test("insights-vocabulary fields advertised by /fields are filterable (utmSource, createdAt)", () => {
  const { where } = compileExtendedGroup(
    {
      combinator: "and",
      conditions: [
        { field: "utmSource", operator: "is", value: "google" },
        { field: "createdAt", operator: "gt", value: "2026-01-01" },
      ],
    },
    catalogWith(),
  );
  assert.ok(where);
  const { sql, params } = render(where);
  assert.match(sql, /"utm_source" = /);
  assert.match(sql, /"add_time" AT TIME ZONE 'Asia\/Riyadh'/);
  assert.deepEqual(params, ["google", "2026-01-01"]);
});

test("base-DSL date aliases still work (createdDate ≡ createdAt, wonTime ≡ wonAt)", () => {
  const { where } = compileExtendedGroup(
    {
      combinator: "and",
      conditions: [
        { field: "createdDate", operator: "is", value: "2026-07-01" },
        { field: "wonTime", operator: "lt", value: "2026-07-01" },
      ],
    },
    catalogWith(),
  );
  assert.ok(where);
  const { sql } = render(where);
  assert.match(sql, /"add_time" AT TIME ZONE/);
  assert.match(sql, /"won_time" AT TIME ZONE/);
});

test("organization conditions flag the required join", () => {
  const { where, needsOrgJoin } = compileExtendedGroup(
    {
      combinator: "and",
      conditions: [{ field: "organization", operator: "contains", value: "Noon" }],
    },
    catalogWith(),
  );
  assert.ok(where);
  assert.equal(needsOrgJoin, true);
  const { sql, params } = render(where);
  assert.match(sql, /"name" ilike /);
  assert.deepEqual(params, ["%Noon%"]);
});

test("cf: conditions compile to a custom_fields accessor with bound value", () => {
  const { where } = compileExtendedGroup(
    {
      combinator: "and",
      conditions: [
        { field: "cf:qualification", operator: "is", value: "unqualified" },
      ],
    },
    catalogWith(QUALIFICATION),
  );
  assert.ok(where);
  const { sql, params } = render(where);
  // Key is a registry-owned literal (matches the expression indexes);
  // the value is a bound parameter.
  assert.match(sql, /"custom_fields" ->> 'qualification'/);
  assert.deepEqual(params, ["unqualified"]);
});

test("boolean cf: fields accept real booleans", () => {
  const { where } = compileExtendedGroup(
    {
      combinator: "and",
      conditions: [{ field: "cf:is_ecommerce", operator: "is", value: true }],
    },
    catalogWith(IS_ECOMMERCE),
  );
  assert.ok(where);
  const { params } = render(where);
  assert.deepEqual(params, ["true"]);
});

test("numeric cf: fields cast and support range operators", () => {
  const { where } = compileExtendedGroup(
    {
      combinator: "and",
      conditions: [
        {
          field: "cf:first_inbound_expected_number_of_sqm_pal",
          operator: "between",
          value: [100, 500],
        },
      ],
    },
    catalogWith(SQM),
  );
  assert.ok(where);
  const { sql, params } = render(where);
  assert.match(sql, /::double precision between /);
  assert.deepEqual(params, [100, 500]);
});

test("unknown cf: keys and unknown native fields are rejected", () => {
  for (const field of ["cf:nope", "dropTables"]) {
    assert.throws(
      () =>
        compileExtendedGroup(
          {
            combinator: "and",
            conditions: [{ field, operator: "is", value: "x" }],
          },
          catalogWith(QUALIFICATION),
        ),
      InsightsQueryError,
      field,
    );
  }
});

test("nested OR groups mix native and cf: conditions", () => {
  const { where } = compileExtendedGroup(
    {
      combinator: "and",
      conditions: [
        { field: "status", operator: "is", value: "lost" },
        {
          combinator: "or",
          conditions: [
            { field: "cf:qualification", operator: "is", value: "qualified" },
            { field: "value", operator: "gt", value: 1000 },
          ],
        },
      ],
    },
    catalogWith(QUALIFICATION),
  );
  assert.ok(where);
  const { sql, params } = render(where);
  assert.match(sql, / or /);
  assert.match(sql, / and /);
  assert.deepEqual(params, ["lost", "qualified", 1000]);
});

test("structural limits are enforced", () => {
  let group = {
    combinator: "and" as const,
    conditions: [
      { field: "status", operator: "is", value: "open" },
    ] as unknown[],
  };
  for (let i = 0; i < 6; i++) {
    group = { combinator: "and", conditions: [group] };
  }
  assert.throws(
    () => compileExtendedGroup(group as never, catalogWith()),
    InsightsQueryError,
  );
});

const BASE_SPEC = {
  version: WIDGET_SPEC_VERSION,
  scope: "deals",
  reportType: "performance",
  measure: { field: "value", agg: "sum" },
  viewBy: { field: "createdAt", dateBucket: "month" },
  filters: { combinator: "and", conditions: [] },
} as const;

test("widget spec schema accepts a catalog-style spec and rejects bad scopes", () => {
  const spec = widgetSpecSchema.parse(BASE_SPEC);
  assert.equal(spec.scope, "deals");
  assert.throws(() =>
    widgetSpecSchema.parse({ ...BASE_SPEC, scope: "everything" }),
  );
});

test("spec.sort resolves to the emitted aliases; unknown fields are rejected, never ignored", () => {
  // Sorting by the viewBy field orders the x dimension.
  assert.deepEqual(
    resolveSortTarget(
      widgetSpecSchema.parse({
        ...BASE_SPEC,
        sort: { field: "createdAt", direction: "asc" },
      }),
    ),
    { alias: "x", direction: "asc" },
  );
  // Sorting by the measure field orders the aggregated value.
  assert.deepEqual(
    resolveSortTarget(
      widgetSpecSchema.parse({
        ...BASE_SPEC,
        sort: { field: "value", direction: "desc" },
      }),
    ),
    { alias: "value", direction: "desc" },
  );
  // No sort → default group ordering.
  assert.equal(resolveSortTarget(widgetSpecSchema.parse(BASE_SPEC)), undefined);
  // Anything else must fail loudly (a stored sort is never a silent no-op).
  assert.throws(
    () =>
      resolveSortTarget(
        widgetSpecSchema.parse({
          ...BASE_SPEC,
          sort: { field: "owner", direction: "asc" },
        }),
      ),
    InsightsQueryError,
  );
});

test("board filters compose as additional AND conditions (intersection)", () => {
  const spec = widgetSpecSchema.parse(BASE_SPEC);
  const { conditions, applied } = compileGlobalFilters(
    {
      ownerIds: [3, 4],
      statuses: ["won", "deleted"], // deleted is not a board status; dropped
      dateRange: { from: "2026-01-01", to: "2026-06-30", basis: "wonAt" },
    },
    spec,
    catalogWith(),
  );
  // owners + statuses + date from + date to
  assert.equal(conditions.length, 4);
  assert.equal(applied.length, 3);
  const rendered = conditions.map((c) => render(c));
  assert.match(rendered[0].sql, /"owner_id" in /);
  assert.deepEqual(rendered[0].params, [3, 4]);
  // Only the allow-listed status survived.
  assert.deepEqual(rendered[1].params, ["won"]);
  assert.match(rendered[2].sql, /"won_time" AT TIME ZONE 'Asia\/Riyadh'/);
});

test("board date range accepts Date instances (generated zod coerces dates)", () => {
  const spec = widgetSpecSchema.parse(BASE_SPEC);
  const { conditions } = compileGlobalFilters(
    {
      dateRange: {
        from: new Date("2026-01-01T00:00:00Z"),
        to: new Date("2026-06-30T00:00:00Z"),
      },
    },
    spec,
    catalogWith(),
  );
  assert.equal(conditions.length, 2);
  const { params } = render(conditions[0]);
  assert.deepEqual(params, ["2026-01-01"]);
});

test("the board Add-filter group is decoded and compiled, not dropped", () => {
  const spec = widgetSpecSchema.parse(BASE_SPEC);
  const encoded = encodeFilters({
    combinator: "and",
    conditions: [{ field: "stage", operator: "is", value: 7 }],
  });
  const { conditions, applied } = compileGlobalFilters(
    { filters: encoded },
    spec,
    catalogWith(),
  );
  assert.equal(conditions.length, 1);
  const { sql, params } = render(conditions[0]);
  assert.match(sql, /"stage_id" = /);
  assert.deepEqual(params, [7]);
  assert.ok(applied.some((a) => a.includes("board condition")));
});

test("unsupported date basis is rejected with a clear error", () => {
  const spec = widgetSpecSchema.parse(BASE_SPEC);
  assert.throws(
    () =>
      compileGlobalFilters(
        { dateRange: { from: "2026-01-01", basis: "invoiceDate" } },
        spec,
        catalogWith(),
      ),
    InsightsQueryError,
  );
});

const { pipelineFromFilters } = await import("./compile-funnel.ts");

test("funnel pipeline resolution finds `pipeline is N` in nested groups", () => {
  assert.equal(
    pipelineFromFilters({
      combinator: "and",
      conditions: [
        { field: "status", operator: "is", value: "open" },
        {
          combinator: "or",
          conditions: [{ field: "pipeline", operator: "is", value: 3 }],
        },
      ],
    }),
    3,
  );
  assert.equal(
    pipelineFromFilters({ combinator: "and", conditions: [] }),
    undefined,
  );
});
