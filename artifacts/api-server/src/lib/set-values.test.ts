import { test } from "node:test";
import assert from "node:assert/strict";
import { coerceSetValue } from "./set-values.ts";

test("wraps an inbound scalar into an array", () => {
  // The bug this module exists for: a bare string renders as an EMPTY set.
  assert.deepEqual(coerceSetValue("Enterprise"), ["Enterprise"]);
});

test("trims, collapses whitespace and dedupes members", () => {
  assert.deepEqual(
    coerceSetValue(["  Enterprise ", "Enterprise", "Mid  market"]),
    ["Enterprise", "Mid market"],
  );
});

test("keeps an unrecognised member rather than dropping it", () => {
  assert.deepEqual(coerceSetValue("Brand New Segment"), ["Brand New Segment"]);
});

test("ignores empty and null members", () => {
  assert.deepEqual(coerceSetValue([null, "", "  ", "SMB"]), ["SMB"]);
  assert.deepEqual(coerceSetValue(null), []);
  assert.deepEqual(coerceSetValue([]), []);
});
