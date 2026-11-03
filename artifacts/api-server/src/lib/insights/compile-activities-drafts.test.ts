import { test, mock, before, after } from "node:test";
import assert from "node:assert/strict";

// Drafts are creator-only everywhere in the app, and the activities report once
// ignored that: grouping by subject read other users' draft subjects back, and
// a `note contains` filter probed their text. This drives the REAL
// runActivitiesPerformance with the report runner mocked at the seam, so the
// wiring (does the predicate reach the query?) is what is pinned, not a helper.
// Needs --experimental-test-module-mocks (set in the package's test script).

process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/insights_test";

const captured: import("drizzle-orm").SQL[][] = [];

before(async () => {
  const realFields = await import("./fields.ts");
  const realAnalytics = await import("./analytics-db.ts");
  mock.module("./fields.ts", {
    namedExports: {
      ...realFields,
      loadDealsFieldCatalog: async () => ({ fields: [], customByRef: new Map() }),
    },
  });
  mock.module("./analytics-db.ts", {
    namedExports: {
      ...realAnalytics,
      runPerformanceReport: async (args: { conditions: import("drizzle-orm").SQL[] }) => {
        captured.push(args.conditions);
        return { rows: [], series: [], appliedFilters: { board: [], widget: [] } };
      },
    },
  });
});

after(() => {
  mock.reset();
});

test("the activities report never reads draft activities", async () => {
  const { PgDialect } = await import("drizzle-orm/pg-core");
  const { runActivitiesPerformance } = await import("./compile-activities.ts");
  const { widgetSpecSchema, WIDGET_SPEC_VERSION } = await import("@workspace/insights-spec");

  await runActivitiesPerformance(
    widgetSpecSchema.parse({
      version: WIDGET_SPEC_VERSION,
      scope: "activities",
      reportType: "performance",
      measure: { field: "id", agg: "count" },
      viewBy: { field: "subject" },
      filters: {
        combinator: "and",
        conditions: [{ field: "note", operator: "contains", value: "private" }],
      },
    }),
    null,
  );

  assert.equal(captured.length, 1);
  const dialect = new PgDialect();
  const rendered = captured[0].map((c) => dialect.sqlToQuery(c).sql);
  assert.ok(
    rendered.some((s) => /"activities"\."draft" = false/.test(s)),
    `no draft predicate in: ${rendered.join(" | ")}`,
  );
});
