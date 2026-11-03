import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isRealIsoDate,
  resolveSymbolicRange,
  datesOrderError,
  appDateInDays,
  APP_TIMEZONE,
  toolDateFromSchema,
  toolDateToSchema,
  SYMBOLIC_PERIODS,
} from "./assistant-dates.ts";

// A fixed "today" (2026-07-16, in Q3) so range math is deterministic and
// independent of when the suite runs. resolveSymbolicRange takes the day as a
// UTC-midnight Date, so tests never touch the timezone/Intl path.
const JUL_16_2026 = new Date(Date.UTC(2026, 6, 16));

// --- isRealIsoDate: real date, not just the right shape ---------------------

test("isRealIsoDate accepts real ISO dates incl. leap day", () => {
  assert.equal(isRealIsoDate("2026-07-16"), true);
  assert.equal(isRealIsoDate("2024-02-29"), true); // 2024 is a leap year
  assert.equal(isRealIsoDate("2026-01-01"), true);
  assert.equal(isRealIsoDate("2026-12-31"), true);
});

test("isRealIsoDate rejects impossible or malformed dates", () => {
  assert.equal(isRealIsoDate("2026-02-30"), false); // Feb 30 doesn't exist
  assert.equal(isRealIsoDate("2023-02-29"), false); // 2023 not a leap year
  assert.equal(isRealIsoDate("2026-13-01"), false); // month 13
  assert.equal(isRealIsoDate("2026-00-10"), false); // month 0
  assert.equal(isRealIsoDate("2026-07-32"), false); // day 32
  assert.equal(isRealIsoDate("2026-7-3"), false); // wrong shape
  assert.equal(isRealIsoDate("last week"), false); // symbolic-with-space
  assert.equal(isRealIsoDate("2026-07-16 "), false); // trailing space
  assert.equal(isRealIsoDate(""), false);
});

// --- resolveSymbolicRange: fixed calendar boundaries ------------------------

test("resolveSymbolicRange: today / yesterday", () => {
  assert.deepEqual(resolveSymbolicRange("today", JUL_16_2026), {
    dateFrom: "2026-07-16",
    dateTo: "2026-07-16",
  });
  assert.deepEqual(resolveSymbolicRange("yesterday", JUL_16_2026), {
    dateFrom: "2026-07-15",
    dateTo: "2026-07-15",
  });
});

test("resolveSymbolicRange: this_month / last_month with 30/31-day ends", () => {
  assert.deepEqual(resolveSymbolicRange("this_month", JUL_16_2026), {
    dateFrom: "2026-07-01",
    dateTo: "2026-07-31",
  });
  assert.deepEqual(resolveSymbolicRange("last_month", JUL_16_2026), {
    dateFrom: "2026-06-01",
    dateTo: "2026-06-30",
  });
  // 30-day month
  assert.deepEqual(resolveSymbolicRange("this_month", new Date(Date.UTC(2026, 3, 10))), {
    dateFrom: "2026-04-01",
    dateTo: "2026-04-30",
  });
});

test("resolveSymbolicRange: last_month rolls over the year boundary", () => {
  assert.deepEqual(resolveSymbolicRange("last_month", new Date(Date.UTC(2026, 0, 10))), {
    dateFrom: "2025-12-01",
    dateTo: "2025-12-31",
  });
});

test("resolveSymbolicRange: leap-year February end", () => {
  assert.deepEqual(resolveSymbolicRange("this_month", new Date(Date.UTC(2024, 1, 10))), {
    dateFrom: "2024-02-01",
    dateTo: "2024-02-29",
  });
});

test("resolveSymbolicRange: this_quarter / last_quarter", () => {
  // Q3 (Jul–Sep)
  assert.deepEqual(resolveSymbolicRange("this_quarter", JUL_16_2026), {
    dateFrom: "2026-07-01",
    dateTo: "2026-09-30",
  });
  // last_quarter from Q3 -> Q2 (Apr–Jun)
  assert.deepEqual(resolveSymbolicRange("last_quarter", JUL_16_2026), {
    dateFrom: "2026-04-01",
    dateTo: "2026-06-30",
  });
});

test("resolveSymbolicRange: last_quarter from Q1 rolls to previous year's Q4", () => {
  assert.deepEqual(resolveSymbolicRange("last_quarter", new Date(Date.UTC(2026, 1, 10))), {
    dateFrom: "2025-10-01",
    dateTo: "2025-12-31",
  });
});

test("resolveSymbolicRange: this_year / last_year", () => {
  assert.deepEqual(resolveSymbolicRange("this_year", JUL_16_2026), {
    dateFrom: "2026-01-01",
    dateTo: "2026-12-31",
  });
  assert.deepEqual(resolveSymbolicRange("last_year", JUL_16_2026), {
    dateFrom: "2025-01-01",
    dateTo: "2025-12-31",
  });
});

test("every symbolic period resolves to a valid, ordered range", () => {
  for (const period of SYMBOLIC_PERIODS) {
    const { dateFrom, dateTo } = resolveSymbolicRange(period, JUL_16_2026);
    assert.ok(isRealIsoDate(dateFrom), `${period} dateFrom is a real date`);
    assert.ok(isRealIsoDate(dateTo), `${period} dateTo is a real date`);
    assert.ok(dateFrom <= dateTo, `${period} range is not inverted`);
  }
});

// Weeks run Sunday–Saturday (WEEK_START_DOW = 0).
test("resolveSymbolicRange: this_week spans Sun–Sat for a mid-week today", () => {
  // 2026-07-15 is a Wednesday.
  assert.deepEqual(resolveSymbolicRange("this_week", new Date(Date.UTC(2026, 6, 15))), {
    dateFrom: "2026-07-12", // Sunday
    dateTo: "2026-07-18", // Saturday
  });
});

test("resolveSymbolicRange: this_week starts the same day when today is Sunday", () => {
  // 2026-07-19 is a Sunday — the (dow - WEEK_START_DOW) % 7 == 0 edge.
  assert.deepEqual(resolveSymbolicRange("this_week", new Date(Date.UTC(2026, 6, 19))), {
    dateFrom: "2026-07-19",
    dateTo: "2026-07-25",
  });
});

test("resolveSymbolicRange: last_week crosses a month boundary", () => {
  // 2026-07-05 is a Sunday; the prior Sun–Sat week straddles June/July.
  assert.deepEqual(resolveSymbolicRange("last_week", new Date(Date.UTC(2026, 6, 5))), {
    dateFrom: "2026-06-28",
    dateTo: "2026-07-04",
  });
});

test("this_week/last_week are offered (Sun–Sat)", () => {
  assert.ok((SYMBOLIC_PERIODS as readonly string[]).includes("this_week"));
  assert.ok((SYMBOLIC_PERIODS as readonly string[]).includes("last_week"));
});

// --- datesOrderError: recoverable inverted-range message --------------------

test("datesOrderError flags an inverted range, allows equal/absent bounds", () => {
  assert.equal(datesOrderError("2026-07-01", "2026-07-31"), undefined);
  assert.equal(datesOrderError("2026-07-16", "2026-07-16"), undefined); // equal ok
  assert.equal(datesOrderError(undefined, "2026-07-31"), undefined);
  assert.equal(datesOrderError("2026-07-01", undefined), undefined);
  const msg = datesOrderError("2026-07-31", "2026-07-01");
  assert.ok(msg && msg.includes("after"), "inverted range produces a message");
});

// --- The Zod field schemas (wiring behaviour, deterministic parts only) -----

test("toolDate schemas: real ISO passes through unchanged; undefined stays undefined", () => {
  assert.equal(toolDateFromSchema.parse("2026-07-01"), "2026-07-01");
  assert.equal(toolDateToSchema.parse("2026-07-31"), "2026-07-31");
  assert.equal(toolDateFromSchema.parse(undefined), undefined);
  assert.equal(toolDateToSchema.parse(undefined), undefined);
});

test("toolDate schemas: garbage fails with a self-correcting message", () => {
  const r = toolDateFromSchema.safeParse("last week");
  assert.equal(r.success, false);
  if (!r.success) {
    const m = r.error.issues.map((i) => i.message).join("; ");
    assert.ok(m.includes("dateFrom"), "names the field");
    assert.ok(m.includes("YYYY-MM-DD"), "states the accepted format");
  }
  assert.equal(toolDateToSchema.safeParse("2026-02-30").success, false); // impossible date
});

test("toolDate schemas: a symbolic value resolves to a real date, from<=to", () => {
  const from = toolDateFromSchema.parse("this_month");
  const to = toolDateToSchema.parse("this_month");
  assert.ok(typeof from === "string" && isRealIsoDate(from));
  assert.ok(typeof to === "string" && isRealIsoDate(to));
  assert.ok(from! <= to!, "from edge is on/before to edge");
});

// --- App-time-zone "today" helpers -----------------------------------------

test("APP_TIMEZONE comes from the APP_TIMEZONE env var, defaulting to UTC", () => {
  assert.equal(APP_TIMEZONE, process.env.APP_TIMEZONE || "UTC");
});

// The zone is read once at module load, so a non-default zone needs a fresh
// module instance: set the env var, then import under a cache-busting query.
async function loadDatesIn(timeZone: string): Promise<typeof import("./assistant-dates.ts")> {
  const previous = process.env.APP_TIMEZONE;
  process.env.APP_TIMEZONE = timeZone;
  try {
    return await import(`./assistant-dates.ts?tz=${encodeURIComponent(timeZone)}`);
  } finally {
    if (previous === undefined) delete process.env.APP_TIMEZONE;
    else process.env.APP_TIMEZONE = previous;
  }
}

test("appTodayIso / appToday agree and follow the configured zone", async () => {
  const fixedNow = new Date("2026-07-16T22:30:00.000Z"); // 01:30 next day at UTC+3
  const utc = await loadDatesIn("UTC");
  assert.equal(utc.appTodayIso(fixedNow), "2026-07-16");
  const plus3 = await loadDatesIn("Europe/Istanbul");
  const isoStr = plus3.appTodayIso(fixedNow);
  assert.match(isoStr, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(isoStr, "2026-07-17"); // crossed midnight at UTC+3
  assert.equal(plus3.appToday(fixedNow).toISOString().slice(0, 10), "2026-07-17");
});

test("appDateInDays counts from the local day, not the UTC one", async () => {
  // 01:30 on the 17th at UTC+3, still the 16th in UTC: "due today" is the 17th.
  const earlyMorning = new Date("2026-07-16T22:30:00.000Z");
  const plus3 = await loadDatesIn("Europe/Istanbul");
  assert.equal(plus3.appDateInDays(0, earlyMorning), "2026-07-17");
  assert.equal(plus3.appDateInDays(3, earlyMorning), "2026-07-20");
  // Month and year boundaries roll over.
  assert.equal(appDateInDays(1, new Date("2026-12-31T12:00:00.000Z")), "2027-01-01");
});
