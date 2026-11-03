import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatExactTime,
  formatNumber,
  formatRelativeShort,
  formatShortDate,
  formatMonthDay,
  formatMonthYear,
  riyadhDayKey,
} from "./format";
import { setActiveLocale } from "./i18n/active-locale";
import { intlDateTag } from "./i18n/formatting";

// lib/format.ts predates i18n and is called from dozens of files that never
// see a locale. It follows the active one; the English output is pinned to
// what it was before, byte for byte: adding Arabic must not change English.

afterEach(() => setActiveLocale("en"));

const when = "2023-10-22T10:51:00Z"; // 13:51 in Riyadh

test("English output is unchanged", () => {
  setActiveLocale("en");
  assert.equal(formatCurrency(132000), "SAR132,000");
  assert.equal(formatNumber(1234567), "1,234,567");
  assert.equal(formatDate(when), "October 22, 2023");
  assert.equal(formatDateTime(when), "October 22, 2023 1:51 PM");
  assert.equal(formatExactTime(when), "Oct 22, 2023, 1:51 PM");
  assert.equal(formatRelativeShort(new Date(Date.now() - 5 * 60_000)), "5m ago");
  assert.equal(formatRelativeShort(new Date(Date.now() + 3 * 86_400_000)), "in 3d");
  assert.equal(formatRelativeShort(new Date()), "just now");
});

test("Arabic goes through Intl with Latin digits and the Gregorian calendar", () => {
  setActiveLocale("ar");
  assert.equal(formatDate(when), "22 أكتوبر 2023");
  assert.match(formatDateTime(when), /^22 أكتوبر 2023 1:51 م$/);
  assert.match(formatCurrency(132000), /132,000/);
  assert.equal(formatNumber(1234567), "1,234,567");
  assert.match(formatRelativeShort(new Date(Date.now() - 5 * 60_000)), /5 دقائق/);
  assert.equal(formatRelativeShort(new Date()), "الآن");
});

test("the date tag carries one -u- extension sequence", () => {
  // `ar-SA-u-nu-latn-u-ca-gregory` is a RangeError; the calendar has to
  // join the numbering system inside the same sequence.
  assert.equal(intlDateTag("ar"), "ar-SA-u-nu-latn-ca-gregory");
  assert.doesNotThrow(() => new Intl.DateTimeFormat(intlDateTag("ar")));
});

test("short calendar dates match what date-fns produced in English", () => {
  setActiveLocale("en");
  const d = new Date(2023, 9, 22); // local midnight, as parseISO("2023-10-22") yields
  assert.equal(formatShortDate(d), "Oct 22, 2023");
  assert.equal(formatMonthDay(d), "Oct 22");
  assert.equal(formatMonthYear(d), "Oct 2023");
  setActiveLocale("ar");
  assert.equal(formatShortDate(d), "22 أكتوبر 2023");
});

test("riyadhDayKey is the Riyadh calendar day, not the UTC one", () => {
  // 22:30 UTC on the 31st is 01:30 on the 1st in Riyadh.
  assert.equal(riyadhDayKey("2026-08-31T22:30:00Z"), "2026-09-01");
  assert.equal(riyadhDayKey("2026-08-31T20:30:00Z"), "2026-08-31");
  // Pinned to Latin digits and the Gregorian calendar whatever the UI language.
  setActiveLocale("ar");
  assert.equal(riyadhDayKey("2023-10-22T10:51:00Z"), "2023-10-22");
});
