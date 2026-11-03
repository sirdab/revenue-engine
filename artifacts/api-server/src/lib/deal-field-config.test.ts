import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeFieldConfig } from "./deal-field-config";

test("leaves a config without pipelineIds untouched", () => {
  const c = { group: "WMS", required: true };
  assert.equal(normalizeFieldConfig(c), c);
});

test("an empty list means every pipeline and is dropped", () => {
  assert.deepEqual(normalizeFieldConfig({ group: "WMS", pipelineIds: [] }), { group: "WMS" });
});

test("cleans junk and duplicates out of the list", () => {
  const dirty = { pipelineIds: [3, "3", 0, -1, 2.5, "x", 7] as unknown as number[] };
  assert.deepEqual(normalizeFieldConfig(dirty), { pipelineIds: [3, 7] });
});

test("a non-array value is treated as every pipeline", () => {
  assert.deepEqual(
    normalizeFieldConfig({ pipelineIds: "5" as unknown as number[] }),
    {},
  );
});
