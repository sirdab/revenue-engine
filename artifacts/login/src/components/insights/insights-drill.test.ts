import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  decodeExtendedFilters,
  type ExtendedFilterGroup,
  type FilterGroup,
} from "@workspace/deals-filter";
import type { InsightsWidgetSpec } from "@workspace/api-client-react";
import { buildDealsDrillUrl, canDrillSpec, type DrillClick } from "./insights-drill";

// The drill mapping is the trickiest correctness logic on the client: AND
// groups may widen (drop unmappable conditions — superset is safe), OR groups
// must never narrow (drop whole group instead), and the clicked dimension
// must map exactly or not drill at all.

function spec(partial: Partial<InsightsWidgetSpec>): InsightsWidgetSpec {
  return {
    version: 1,
    scope: "deals",
    reportType: "performance",
    measure: { field: "id", agg: "count" },
    filters: { combinator: "and", conditions: [] },
    ...partial,
  } as InsightsWidgetSpec;
}

function decodeUrlFilters(url: string): FilterGroup {
  const encoded = new URL(url, "http://localhost").searchParams.get("filters");
  assert.ok(encoded, "drill URL carries a filters param");
  return decodeExtendedFilters(encoded) as FilterGroup;
}

function flatten(group: FilterGroup): { field: string; operator: string; value?: unknown }[] {
  const out: { field: string; operator: string; value?: unknown }[] = [];
  for (const node of group.conditions) {
    if ((node as FilterGroup).combinator !== undefined) {
      out.push(...flatten(node as FilterGroup));
    } else {
      out.push(node as { field: string; operator: string; value?: unknown });
    }
  }
  return out;
}

describe("canDrillSpec", () => {
  it("allows a deals performance spec with mappable dimensions", () => {
    assert.equal(canDrillSpec(spec({ viewBy: { field: "owner" } })), true);
  });

  it("rejects other scopes and unmappable dimensions", () => {
    assert.equal(canDrillSpec(spec({ scope: "activities" })), false);
    assert.equal(canDrillSpec(spec({ viewBy: { field: "cf:region" } })), false);
    assert.equal(canDrillSpec(spec({ viewBy: { field: "utmSource" } })), false);
  });
});

describe("buildDealsDrillUrl", () => {
  it("maps a month-bucket click to a between range on the base date field", () => {
    const click: DrillClick = {
      x: { field: "createdAt", value: "2026-03-01", dateBucket: "month" },
    };
    const res = buildDealsDrillUrl(spec({ viewBy: { field: "createdAt", dateBucket: "month" } }), undefined, click);
    assert.ok(res);
    const conds = flatten(decodeUrlFilters(res.url));
    const range = conds.find((c) => c.field === "createdDate");
    assert.deepEqual(range, {
      field: "createdDate",
      operator: "between",
      value: ["2026-03-01", "2026-03-31"],
    });
  });

  it("adds the open+won+lost parity group when nothing references status", () => {
    const res = buildDealsDrillUrl(
      spec({ viewBy: { field: "owner" } }),
      undefined,
      { x: { field: "owner", value: 4 } },
    );
    assert.ok(res);
    const conds = flatten(decodeUrlFilters(res.url));
    const statuses = conds.filter((c) => c.field === "status").map((c) => c.value);
    assert.deepEqual(statuses.sort(), ["lost", "open", "won"]);
  });

  it("drops unmappable conditions from AND groups (widening is safe) and reports them", () => {
    const filters: ExtendedFilterGroup = {
      combinator: "and",
      conditions: [
        { field: "owner", operator: "is", value: 2 },
        { field: "cf:region", operator: "is", value: "east" },
      ],
    };
    const res = buildDealsDrillUrl(
      spec({ viewBy: { field: "owner" }, filters: filters as never }),
      undefined,
      { x: { field: "owner", value: 2 } },
    );
    assert.ok(res);
    assert.deepEqual(res.dropped, ["cf:region"]);
    const conds = flatten(decodeUrlFilters(res.url));
    assert.ok(conds.some((c) => c.field === "owner" && c.value === 2));
    assert.ok(!conds.some((c) => c.field === "cf:region"));
  });

  it("drops an OR group whole when any branch is unmappable (never narrow)", () => {
    const filters: ExtendedFilterGroup = {
      combinator: "and",
      conditions: [
        {
          combinator: "or",
          conditions: [
            { field: "owner", operator: "is", value: 2 },
            { field: "cf:region", operator: "is", value: "east" },
          ],
        },
      ],
    };
    const res = buildDealsDrillUrl(
      spec({ viewBy: { field: "owner" }, filters: filters as never }),
      undefined,
      { x: { field: "owner", value: 2 } },
    );
    assert.ok(res);
    // The whole OR group is gone; both branch fields are reported dropped.
    assert.deepEqual(res.dropped.sort(), ["cf:region", "owner"]);
    const conds = flatten(decodeUrlFilters(res.url));
    // Only the clicked dimension + status parity remain.
    assert.equal(conds.filter((c) => c.field === "owner").length, 1);
  });

  it("refuses to drill when the clicked dimension itself cannot be expressed", () => {
    const res = buildDealsDrillUrl(
      spec({ viewBy: { field: "utmSource" } }),
      undefined,
      { x: { field: "utmSource", value: "google" } },
    );
    assert.equal(res, null);
  });

  it("carries board quick filters", () => {
    const res = buildDealsDrillUrl(
      spec({ viewBy: { field: "owner" } }),
      { ownerIds: [1, 2] },
      { x: { field: "owner", value: 1 } },
    );
    assert.ok(res);
    assert.deepEqual(res.dropped, []);
    const conds = flatten(decodeUrlFilters(res.url));
    const owners = conds.filter((c) => c.field === "owner").map((c) => c.value);
    assert.ok(owners.includes(1) && owners.includes(2));
  });
});
