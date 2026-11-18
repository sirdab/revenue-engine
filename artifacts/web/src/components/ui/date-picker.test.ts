import { describe, it } from "node:test"
import assert from "node:assert/strict"

import {
  formatDmy,
  formatYmd,
  isOutOfBounds,
  maskDmyInput,
  parseDmy,
  parseYmd,
  ymdToDmy,
} from "./date-utils"

// The DatePicker is a mechanical control swap; its only intricate logic is the
// timezone-safe string <-> Date conversion (KTD1) and the bounds matcher. The
// runner has no DOM, so we test those pure helpers here. onChange/clear/render
// behavior is a thin wrapper over these and is covered by manual verification.

describe("DatePicker date helpers", () => {
  it("round-trips every day of a leap and common year unchanged", () => {
    // Every day (incl. DST-transition days and Feb 29 of the leap year) must
    // survive parse -> format with the same yyyy-mm-dd string. NOTE: because
    // parse and format both read local calendar fields, this catches a
    // UTC-parse regression (`new Date(value)`) only when the suite runs under a
    // non-UTC zone — under a UTC host local and UTC midnight coincide. parseYmd
    // is local-safe by construction (`new Date(y, m-1, d)` + local getters); the
    // leap/common coverage below is the host-independent guarantee.
    for (const value of [...eachDayOfYear(2024), ...eachDayOfYear(2026)]) {
      const parsed = parseYmd(value)
      assert.ok(parsed, `expected ${value} to parse`)
      assert.equal(formatYmd(parsed), value)
    }
  })

  it("parses to a LOCAL calendar day (no UTC construction)", () => {
    // Pins the local-construction invariant directly: parseYmd must equal the
    // local-time constructor, not `new Date("2026-07-15")` (UTC midnight).
    const parsed = parseYmd("2026-07-15")
    assert.ok(parsed)
    assert.equal(parsed.getFullYear(), 2026)
    assert.equal(parsed.getMonth(), 6) // July (0-indexed)
    assert.equal(parsed.getDate(), 15)
    assert.equal(parsed.getHours(), 0) // local midnight, not shifted
    assert.equal(parsed.getTime(), new Date(2026, 6, 15).getTime())
  })

  it("validates leap-day existence per year", () => {
    // Feb 29 exists in a leap year, not in a common one — the getDate()
    // round-trip guard in parseYmd must reject the impossible common-year date.
    assert.ok(parseYmd("2024-02-29"), "2024 is a leap year")
    assert.equal(parseYmd("2025-02-29"), undefined) // common year, no Feb 29
    assert.equal(parseYmd("2100-02-29"), undefined) // century non-leap year
    assert.ok(parseYmd("2000-02-29"), "2000 is a leap year (÷400)")
  })

  it("returns undefined for empty or malformed input", () => {
    assert.equal(parseYmd(""), undefined)
    assert.equal(parseYmd(null), undefined)
    assert.equal(parseYmd(undefined), undefined)
    assert.equal(parseYmd("2026-7-5"), undefined)
    assert.equal(parseYmd("15/07/2026"), undefined)
    assert.equal(parseYmd("2026-13-01"), undefined) // impossible month
    assert.equal(parseYmd("2026-02-31"), undefined) // impossible day
  })

  it("zero-pads short years when formatting", () => {
    assert.equal(formatYmd(new Date(999, 11, 31)), "0999-12-31")
    // Years 0-99 remap to 1900s via the Date constructor, so set explicitly to
    // exercise the 4-wide pad on a genuinely small year.
    const early = new Date(2000, 0, 5)
    early.setFullYear(7)
    assert.equal(formatYmd(early), "0007-01-05")
  })

  it("treats min/max as inclusive bounds and disables out-of-range days", () => {
    const min = "2026-07-10"
    const max = "2026-07-20"
    assert.equal(isOutOfBounds(day("2026-07-09"), min, max), true)
    assert.equal(isOutOfBounds(day("2026-07-10"), min, max), false) // inclusive
    assert.equal(isOutOfBounds(day("2026-07-15"), min, max), false)
    assert.equal(isOutOfBounds(day("2026-07-20"), min, max), false) // inclusive
    assert.equal(isOutOfBounds(day("2026-07-21"), min, max), true)
  })

  it("disables every day when bounds are inverted (min > max)", () => {
    // An impossible range (min after max) admits no day — a degenerate filter
    // state, but it must not silently allow dates.
    const min = "2026-07-20"
    const max = "2026-07-10"
    assert.equal(isOutOfBounds(day("2026-07-15"), min, max), true)
    assert.equal(isOutOfBounds(day("2026-07-20"), min, max), true)
    assert.equal(isOutOfBounds(day("2026-07-10"), min, max), true)
  })

  it("leaves an unset bound unbounded", () => {
    assert.equal(isOutOfBounds(day("1900-01-01"), undefined, "2026-07-20"), false)
    assert.equal(isOutOfBounds(day("2999-01-01"), "2026-07-10", undefined), false)
    assert.equal(isOutOfBounds(day("2026-07-15"), "", ""), false)
  })
})

describe("DatePicker typed-input helpers (dd/mm/yyyy)", () => {
  it("parses a day-first dd/mm/yyyy string to the yyyy-mm-dd contract", () => {
    assert.equal(parseDmy("15/07/2026"), "2026-07-15")
    assert.equal(parseDmy("06/11/2026"), "2026-11-06")
  })

  it("pads single-digit day and month", () => {
    assert.equal(parseDmy("6/11/2026"), "2026-11-06")
    assert.equal(parseDmy("6/1/2026"), "2026-01-06")
  })

  it("accepts '-' and '.' separators as well as '/'", () => {
    assert.equal(parseDmy("6-11-2026"), "2026-11-06")
    assert.equal(parseDmy("6.11.2026"), "2026-11-06")
  })

  it("trims surrounding whitespace", () => {
    assert.equal(parseDmy("  15/07/2026  "), "2026-07-15")
  })

  it("is day-first, so a >12 first field is not read as a month", () => {
    // 15 can only be a day; 07 the month. The mirror-image 07/15 has an
    // impossible month (15) and must be rejected, not silently swapped.
    assert.equal(parseDmy("15/07/2026"), "2026-07-15")
    assert.equal(parseDmy("07/15/2026"), undefined)
  })

  it("rejects incomplete, empty, or 2-digit-year input", () => {
    assert.equal(parseDmy(""), undefined)
    assert.equal(parseDmy(null), undefined)
    assert.equal(parseDmy(undefined), undefined)
    assert.equal(parseDmy("15/07"), undefined)
    assert.equal(parseDmy("15/07/26"), undefined) // year must be 4 digits
    assert.equal(parseDmy("2026-07-15"), undefined) // wrong shape (yyyy-mm-dd)
    assert.equal(parseDmy("abc"), undefined)
  })

  it("rejects impossible calendar dates", () => {
    assert.equal(parseDmy("31/02/2026"), undefined) // Feb never has 31
    assert.equal(parseDmy("32/01/2026"), undefined) // no 32nd
    assert.equal(parseDmy("01/13/2026"), undefined) // no 13th month
    assert.equal(parseDmy("29/02/2025"), undefined) // common year, no Feb 29
    assert.equal(parseDmy("29/02/2024"), "2024-02-29") // leap year, exists
  })

  it("formats a Date as zero-padded dd/mm/yyyy", () => {
    assert.equal(formatDmy(new Date(2026, 10, 6)), "06/11/2026") // Nov = month 10
    assert.equal(formatDmy(new Date(999, 11, 31)), "31/12/0999")
  })

  it("ymdToDmy converts a stored value, or empty string when unparseable", () => {
    assert.equal(ymdToDmy("2026-11-06"), "06/11/2026")
    assert.equal(ymdToDmy(""), "")
    assert.equal(ymdToDmy(null), "")
    assert.equal(ymdToDmy(undefined), "")
    assert.equal(ymdToDmy("not-a-date"), "")
  })

  it("round-trips every day of a year through the dd/mm/yyyy display", () => {
    for (const value of eachDayOfYear(2024)) {
      assert.equal(parseDmy(ymdToDmy(value)), value, `round-trip ${value}`)
    }
  })
})

describe("DatePicker input mask (maskDmyInput)", () => {
  it("auto-inserts a separator as soon as the day segment fills", () => {
    assert.equal(maskDmyInput("1"), "1")
    assert.equal(maskDmyInput("17"), "17/")
    assert.equal(maskDmyInput("170"), "17/0")
    assert.equal(maskDmyInput("1703"), "17/03/")
    assert.equal(maskDmyInput("17032"), "17/03/2")
    assert.equal(maskDmyInput("17032026"), "17/03/2026")
  })

  it("drops non-digits so letters and stray punctuation never appear", () => {
    assert.equal(maskDmyInput("1a7"), "17/")
    assert.equal(maskDmyInput("abc"), "")
    assert.equal(maskDmyInput("17-03-2026"), "17/03/2026")
    assert.equal(maskDmyInput("17/03/2026"), "17/03/2026")
  })

  it("caps at 8 digits (ddmmyyyy), ignoring overflow", () => {
    assert.equal(maskDmyInput("170320269999"), "17/03/2026")
  })

  it("produces a mask that parseDmy reads back once complete", () => {
    assert.equal(parseDmy(maskDmyInput("17032026")), "2026-03-17")
  })
})

function day(value: string): Date {
  const parsed = parseYmd(value)
  assert.ok(parsed, `test fixture ${value} should parse`)
  return parsed
}

function eachDayOfYear(year: number): string[] {
  const out: string[] = []
  for (let month = 1; month <= 12; month++) {
    const daysInMonth = new Date(year, month, 0).getDate()
    for (let d = 1; d <= daysInMonth; d++) {
      out.push(
        `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
      )
    }
  }
  return out
}
