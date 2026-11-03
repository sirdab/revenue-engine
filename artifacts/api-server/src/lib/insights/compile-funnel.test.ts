import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ExtendedFilterGroup } from "@workspace/deals-filter";

// compile-funnel transitively imports the pg Pool. The pool never connects
// until a query executes, so a dummy URL lets the pure paths run without a DB.
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/insights_test";

const { pipelineFromFilters } = await import("./compile-funnel.ts");

const group = (conditions: ExtendedFilterGroup["conditions"]): ExtendedFilterGroup => ({
  combinator: "and",
  conditions,
});

describe("pipelineFromFilters", () => {
  it("finds a top-level `pipeline is N` condition", () => {
    assert.equal(
      pipelineFromFilters(group([{ field: "pipeline", operator: "is", value: 5 }])),
      5,
    );
  });

  it("coerces a stringified id (URL round-trips carry strings)", () => {
    assert.equal(
      pipelineFromFilters(group([{ field: "pipeline", operator: "is", value: "7" }])),
      7,
    );
  });

  it("finds the condition inside a nested group", () => {
    assert.equal(
      pipelineFromFilters(
        group([
          { field: "status", operator: "is", value: "open" },
          {
            combinator: "or",
            conditions: [{ field: "pipeline", operator: "is", value: 3 }],
          },
        ]),
      ),
      3,
    );
  });

  it("ignores non-`is` operators — `pipeline is_not N` picks nothing", () => {
    assert.equal(
      pipelineFromFilters(
        group([{ field: "pipeline", operator: "is_not", value: 5 }]),
      ),
      undefined,
    );
  });

  it("ignores non-numeric values", () => {
    assert.equal(
      pipelineFromFilters(
        group([{ field: "pipeline", operator: "is", value: "sales" }]),
      ),
      undefined,
    );
  });

  it("returns undefined for an empty group", () => {
    assert.equal(pipelineFromFilters(group([])), undefined);
  });
});
