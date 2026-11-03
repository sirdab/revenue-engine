import { test } from "node:test";
import assert from "node:assert/strict";
import { retryDates } from "./retry-dates.ts";

// Local-calendar dates: new Date(y, m, d) — the helper never touches UTC.
test("a Monday offers Tuesday, Wednesday and the next Monday", () => {
  assert.deepEqual(retryDates(new Date(2026, 9, 5)), {
    nextWorkingDay: "2026-10-06",
    twoWorkingDays: "2026-10-07",
    inAWeek: "2026-10-12",
  });
});

test("a Friday skips the Saturday–Sunday weekend", () => {
  // Fri 2 Oct 2026 → Mon 5, Tue 6; a week later is Fri 9.
  assert.deepEqual(retryDates(new Date(2026, 9, 2)), {
    nextWorkingDay: "2026-10-05",
    twoWorkingDays: "2026-10-06",
    inAWeek: "2026-10-09",
  });
});

test("logging on a weekend day still lands on working days", () => {
  // Sat 3 Oct 2026: next working day Mon 5; a week later is Sat 10 → Mon 12.
  assert.deepEqual(retryDates(new Date(2026, 9, 3)), {
    nextWorkingDay: "2026-10-05",
    twoWorkingDays: "2026-10-06",
    inAWeek: "2026-10-12",
  });
});

test("month and year boundaries roll over", () => {
  // Thu 31 Dec 2026 → Fri 1 Jan, then Mon 4 Jan 2027.
  const d = retryDates(new Date(2026, 11, 31));
  assert.equal(d.nextWorkingDay, "2027-01-01");
  assert.equal(d.twoWorkingDays, "2027-01-04");
});
