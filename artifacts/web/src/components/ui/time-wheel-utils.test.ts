import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaultWheelTime,
  formatHm,
  minuteOptions,
  parseHm,
} from "./time-wheel-utils";

test("midnight and noon map to 12 on the wheel", () => {
  assert.deepEqual(parseHm("00:15"), { hour: 12, minute: 15, period: "am" });
  assert.deepEqual(parseHm("12:00"), { hour: 12, minute: 0, period: "pm" });
  assert.equal(formatHm({ hour: 12, minute: 15, period: "am" }), "00:15");
  assert.equal(formatHm({ hour: 12, minute: 0, period: "pm" }), "12:00");
});

test("every time of day round-trips", () => {
  for (let h = 0; h < 24; h++) {
    const hm = `${String(h).padStart(2, "0")}:35`;
    assert.equal(formatHm(parseHm(hm)!), hm);
  }
});

test("seconds from the API are tolerated, garbage is not", () => {
  assert.deepEqual(parseHm("14:30:00"), { hour: 2, minute: 30, period: "pm" });
  assert.equal(parseHm(""), undefined);
  assert.equal(parseHm("25:00"), undefined);
  assert.equal(parseHm(null), undefined);
});

test("an off-step saved minute stays selectable", () => {
  assert.equal(minuteOptions(30).length, 12);
  assert.deepEqual(minuteOptions(32).slice(6, 8), [30, 32]);
});

test("the wheels open on the next whole hour", () => {
  assert.equal(formatHm(defaultWheelTime(new Date(2026, 9, 18, 14, 20))), "15:00");
  assert.equal(formatHm(defaultWheelTime(new Date(2026, 9, 18, 23, 50))), "00:00");
});
