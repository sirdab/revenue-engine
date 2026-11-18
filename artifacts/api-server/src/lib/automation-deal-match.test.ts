import { test } from "node:test";
import assert from "node:assert/strict";
import type { DealFacts, FilterGroup } from "@workspace/deals-filter";

// automations.ts imports `db` from @workspace/db, whose pool construction
// throws synchronously without a DATABASE_URL. The matcher under test is pure —
// nothing here opens a connection.
process.env.DATABASE_URL ??= "postgres://automation-match-test/unused";

const { dealAutomationMatches } = await import("./automations.ts");

const facts = (over: Partial<DealFacts> = {}): DealFacts => ({
  title: "Northwind",
  organizationName: null,
  value: 1000,
  pipelineId: 1,
  stageId: 3,
  ownerId: 7,
  createdDate: new Date("2026-01-01T00:00:00Z"),
  wonTime: null,
  status: "open",
  utmKeyword: null,
  lostReason: null,
  ...over,
});
const open = facts();
const won = facts({ status: "won", wonTime: new Date("2026-09-01T09:00:00Z") });

const isWon = {
  combinator: "and",
  conditions: [{ field: "status", operator: "is", value: "won" }],
} as unknown as FilterGroup;
const noConditions = { combinator: "and", conditions: [] } as FilterGroup;

test("deal_updated: open -> won enters the condition and fires", () => {
  assert.equal(dealAutomationMatches(isWon, won, open), true);
});

test("deal_updated: an edit on a deal that was already won does not fire", () => {
  // A label or comment edit leaves every fact unchanged; so does a value edit.
  assert.equal(dealAutomationMatches(isWon, won, won), false);
  assert.equal(dealAutomationMatches(isWon, { ...won, value: 5 }, won), false);
});

test("deal_updated: won -> open -> won fires again on the second win", () => {
  assert.equal(dealAutomationMatches(isWon, open, won), false);
  assert.equal(dealAutomationMatches(isWon, won, open), true);
});

test("deal_updated: leaving the condition never fires", () => {
  assert.equal(dealAutomationMatches(isWon, facts({ status: "lost" }), won), false);
});

test("deal_updated: every condition in an AND must be newly true together", () => {
  const wonAndBig = {
    combinator: "and",
    conditions: [
      { field: "status", operator: "is", value: "won" },
      { field: "value", operator: "gt", value: 500 },
    ],
  } as unknown as FilterGroup;
  // Already won, value rises past the threshold: the deal enters the pair now.
  assert.equal(
    dealAutomationMatches(wonAndBig, { ...won, value: 900 }, { ...won, value: 100 }),
    true,
  );
  // Already matching both: a further value change is not an entry.
  assert.equal(
    dealAutomationMatches(wonAndBig, { ...won, value: 900 }, { ...won, value: 800 }),
    false,
  );
});

test("deal_updated: an automation with no conditions fires on every change", () => {
  assert.equal(dealAutomationMatches(noConditions, won, won), true);
  const nestedEmpty = {
    combinator: "and",
    conditions: [{ combinator: "or", conditions: [] }],
  } as unknown as FilterGroup;
  assert.equal(dealAutomationMatches(nestedEmpty, won, won), true);
});

test("deal_added (no before): fires whenever the new deal matches", () => {
  assert.equal(dealAutomationMatches(isWon, won, null), true);
  assert.equal(dealAutomationMatches(isWon, open, null), false);
  assert.equal(dealAutomationMatches(noConditions, open, null), true);
});

test("broken conditions throw so the engine can log and skip", () => {
  const broken = {
    combinator: "and",
    conditions: [{ field: "status", operator: "is", value: "nope" }],
  } as unknown as FilterGroup;
  assert.throws(() => dealAutomationMatches(broken, won, open));
});
