import { test } from "node:test";
import assert from "node:assert/strict";
import { retryDates } from "./retry-dates.ts";

// Local-calendar dates: new Date(y, m, d) — the helper never touches UTC.
test("a Sunday offers Monday, Tuesday and the next Sunday", () => {
  assert.deepEqual(retryDates(new Date(2026, 9, 4)), {
    nextWorkingDay: "2026-10-05",
    twoWorkingDays: "2026-10-06",
    inAWeek: "2026-10-11",
  });
});

test("a Thursday skips the Friday–Saturday weekend", () => {
  // Thu 1 Oct 2026 → Sun 4, Mon 5; a week later is Thu 8.
  assert.deepEqual(retryDates(new Date(2026, 9, 1)), {
    nextWorkingDay: "2026-10-04",
    twoWorkingDays: "2026-10-05",
    inAWeek: "2026-10-08",
  });
});

test("logging on a weekend day still lands on working days", () => {
  // Fri 2 Oct 2026: next working day Sun 4; a week later is Fri 9 → Sun 11.
  assert.deepEqual(retryDates(new Date(2026, 9, 2)), {
    nextWorkingDay: "2026-10-04",
    twoWorkingDays: "2026-10-05",
    inAWeek: "2026-10-11",
  });
});

test("month and year boundaries roll over", () => {
  // Wed 30 Dec 2026 → Thu 31, then Sun 3 Jan 2027.
  const d = retryDates(new Date(2026, 11, 30));
  assert.equal(d.nextWorkingDay, "2026-12-31");
  assert.equal(d.twoWorkingDays, "2027-01-03");
});
