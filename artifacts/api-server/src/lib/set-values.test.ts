import { test } from "node:test";
import assert from "node:assert/strict";
import { coerceSetValue } from "./set-values.ts";

test("wraps an inbound scalar into an array", () => {
  // The bug this module exists for: a bare string renders as an EMPTY set.
  assert.deepEqual(coerceSetValue("LSC"), ["LSC"]);
});

test("dedupes repeated members", () => {
  assert.deepEqual(coerceSetValue(["LSC", "LSC", " LSC "]), ["LSC"]);
});

test("keeps an unrecognised member rather than dropping it", () => {
  // Dropping would destroy data on an unwatched path; an unknown chip is a
  // visible problem an admin can fix.
  assert.deepEqual(coerceSetValue("Brand New Partner"), ["Brand New Partner"]);
});

test("ignores empty and null members", () => {
  assert.deepEqual(coerceSetValue([null, "", "  ", "LSC"]), ["LSC"]);
  assert.deepEqual(coerceSetValue(null), []);
  assert.deepEqual(coerceSetValue([]), []);
});
