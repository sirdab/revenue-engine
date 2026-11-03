import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { WidgetSpec } from "@workspace/insights-spec";

// run-query transitively imports the pg Pool. The pool never connects until
// a query executes, so a dummy URL lets the pure paths run without a DB.
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/insights_test";

const { InsightsQueryError } = await import("./compile-deals.ts");
const { runInsightsSpec, stableStringify } = await import("./run-query.ts");

describe("stableStringify", () => {
  it("is insensitive to object key order (the cache key must dedupe clients)", () => {
    const a = stableStringify({ spec: { scope: "deals", limit: 5 }, global: null });
    const b = stableStringify({ global: null, spec: { limit: 5, scope: "deals" } });
    assert.equal(a, b);
  });

  it("preserves array order (filter condition order is meaningful)", () => {
    assert.notEqual(stableStringify([1, 2]), stableStringify([2, 1]));
  });

  it("drops undefined properties like JSON.stringify does", () => {
    assert.equal(
      stableStringify({ a: 1, b: undefined }),
      stableStringify({ a: 1 }),
    );
  });

  it("handles nested structures and primitives", () => {
    assert.equal(
      stableStringify({ x: [{ b: 2, a: "s" }], y: true }),
      '{"x":[{"a":"s","b":2}],"y":true}',
    );
  });
});

describe("runInsightsSpec", () => {
  it("rejects a not-yet-implemented scope/report with InsightsQueryError (→ 400)", async () => {
    const spec: WidgetSpec = {
      version: 1,
      scope: "organizations",
      reportType: "performance",
      measure: { field: "id", agg: "count" },
      filters: { combinator: "and", conditions: [] },
    };
    await assert.rejects(
      runInsightsSpec(spec, null),
      (err: unknown) => err instanceof InsightsQueryError,
    );
  });
});
