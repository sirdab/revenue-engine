import { test } from "node:test";
import assert from "node:assert/strict";
import { canReassignDeals } from "./deal-reassign";

const pipelines = [
  { id: 1, adminOnlyReassign: true },
  { id: 2, adminOnlyReassign: false },
];

test("an admin may reassign in any pipeline", () => {
  assert.equal(canReassignDeals(true, [1, 2], pipelines), true);
});

test("a rep may reassign only outside locked pipelines", () => {
  assert.equal(canReassignDeals(false, [2], pipelines), true);
  assert.equal(canReassignDeals(false, [1], pipelines), false);
});

test("one locked deal in a selection hides reassignment for the rep", () => {
  assert.equal(canReassignDeals(false, [2, 2, 1], pipelines), false);
});

test("an unknown pipeline reads as unlocked (the server decides)", () => {
  assert.equal(canReassignDeals(false, [99], pipelines), true);
  assert.equal(canReassignDeals(false, [1], []), true);
});
