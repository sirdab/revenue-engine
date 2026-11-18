import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { startOfDay } from "date-fns";
import {
  activityPriorityOf,
  ACTIVITY_PRIORITY_ORDER,
  ACTIVITY_PRIORITY_META,
} from "./activity-priority.ts";

// Fixed client-local "today" so the boundary cases are deterministic.
const TODAY = startOfDay(new Date(2026, 6, 16)); // 2026-07-16 local midnight

describe("activityPriorityOf", () => {
  it("null / undefined / empty → none", () => {
    assert.equal(activityPriorityOf(null, TODAY), "none");
    assert.equal(activityPriorityOf(undefined, TODAY), "none");
    assert.equal(activityPriorityOf("", TODAY), "none");
  });

  it("due before today → overdue", () => {
    assert.equal(activityPriorityOf("2026-07-15", TODAY), "overdue");
    assert.equal(activityPriorityOf("2020-01-01", TODAY), "overdue");
  });

  it("due exactly today → today (the boundary)", () => {
    assert.equal(activityPriorityOf("2026-07-16", TODAY), "today");
  });

  it("due after today → scheduled", () => {
    assert.equal(activityPriorityOf("2026-07-17", TODAY), "scheduled");
    assert.equal(activityPriorityOf("2027-01-01", TODAY), "scheduled");
  });

  it("time-of-day in the value never leaks past the day boundary", () => {
    // A same-day timestamp still reads as 'today' (startOfDay normalizes it).
    assert.equal(activityPriorityOf("2026-07-16T23:59:00", TODAY), "today");
  });
});

describe("palette", () => {
  it("has all 4 states in urgency order with a class + label each", () => {
    assert.deepEqual(ACTIVITY_PRIORITY_ORDER, [
      "overdue",
      "today",
      "scheduled",
      "none",
    ]);
    for (const p of ACTIVITY_PRIORITY_ORDER) {
      assert.ok(ACTIVITY_PRIORITY_META[p].dot.startsWith("bg-"));
      assert.ok(ACTIVITY_PRIORITY_META[p].label.length > 0);
    }
  });
});
