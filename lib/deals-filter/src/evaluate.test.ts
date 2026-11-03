import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, type DealFacts } from "./evaluate";
import { EMPTY_FILTER, type FilterGroup } from "./index";

// These tests are the characterization of the SQL compiler's semantics
// (artifacts/api-server/src/lib/queries.ts `compileCondition`). The in-memory
// evaluator MUST agree with it field-by-field — that parity is the whole point
// of U2 (a rule that matches in the builder's mental model but not at runtime
// is the highest risk in the plan). Where the plan's prose and the SQL differ,
// the SQL wins: text `is` uses `=` (case-SENSITIVE); only `contains` is
// case-insensitive (`ilike`).

// A fully-populated baseline; individual tests override the fields they exercise.
function facts(overrides: Partial<DealFacts> = {}): DealFacts {
  return {
    title: "ACME Corp",
    organizationName: "Globex",
    value: 2000,
    pipelineId: 1,
    stageId: 3,
    ownerId: 7,
    // 2026-07-05 21:00 UTC = 2026-07-06 00:00 Riyadh (UTC+3): local date rolls over.
    createdDate: new Date("2026-07-05T09:00:00Z"),
    wonTime: null,
    status: "open",
    utmKeyword: "spring-sale",
    lostReason: null,
    ...overrides,
  };
}

function group(
  combinator: "and" | "or",
  conditions: FilterGroup["conditions"],
): FilterGroup {
  return { combinator, conditions };
}

// --- Happy path -----------------------------------------------------------

test("status is open matches an open deal", () => {
  const g = group("and", [{ field: "status", operator: "is", value: "open" }]);
  assert.equal(evaluate(g, facts({ status: "open" })), true);
  assert.equal(evaluate(g, facts({ status: "won" })), false);
});

test("value gt 1000 matches 2000, not 500", () => {
  const g = group("and", [{ field: "value", operator: "gt", value: 1000 }]);
  assert.equal(evaluate(g, facts({ value: 2000 })), true);
  assert.equal(evaluate(g, facts({ value: 500 })), false);
});

// --- AND / OR / nesting ----------------------------------------------------

test("AND requires all conditions", () => {
  const g = group("and", [
    { field: "status", operator: "is", value: "open" },
    { field: "value", operator: "gt", value: 1000 },
  ]);
  assert.equal(evaluate(g, facts({ status: "open", value: 2000 })), true);
  assert.equal(evaluate(g, facts({ status: "open", value: 500 })), false);
  assert.equal(evaluate(g, facts({ status: "won", value: 2000 })), false);
});

test("OR requires at least one condition", () => {
  const g = group("or", [
    { field: "status", operator: "is", value: "won" },
    { field: "value", operator: "gt", value: 1000 },
  ]);
  assert.equal(evaluate(g, facts({ status: "open", value: 2000 })), true);
  assert.equal(evaluate(g, facts({ status: "won", value: 500 })), true);
  assert.equal(evaluate(g, facts({ status: "open", value: 500 })), false);
});

test("nested group evaluates recursively", () => {
  // status is open AND (value gt 5000 OR utmKeyword contains "spring")
  const g = group("and", [
    { field: "status", operator: "is", value: "open" },
    group("or", [
      { field: "value", operator: "gt", value: 5000 },
      { field: "utmKeyword", operator: "contains", value: "spring" },
    ]),
  ]);
  assert.equal(
    evaluate(g, facts({ status: "open", value: 100, utmKeyword: "spring-sale" })),
    true,
  );
  assert.equal(
    evaluate(g, facts({ status: "open", value: 100, utmKeyword: "winter" })),
    false,
  );
  assert.equal(
    evaluate(g, facts({ status: "won", value: 9000, utmKeyword: "spring" })),
    false,
  );
});

// --- Text semantics --------------------------------------------------------

test("contains is case-insensitive (mirrors ilike)", () => {
  const g = group("and", [
    { field: "title", operator: "contains", value: "acme" },
  ]);
  assert.equal(evaluate(g, facts({ title: "ACME Corp" })), true);
  assert.equal(evaluate(g, facts({ title: "Globex" })), false);
});

test("not_contains is case-insensitive and NULL-inclusive (mirrors `is null or not ilike`)", () => {
  const g = group("and", [
    { field: "title", operator: "not_contains", value: "acme" },
  ]);
  assert.equal(evaluate(g, facts({ title: "ACME Corp" })), false);
  assert.equal(evaluate(g, facts({ title: "Globex" })), true);
  // A null field "does not contain" anything.
  const gNull = group("and", [
    { field: "utmKeyword", operator: "not_contains", value: "sale" },
  ]);
  assert.equal(evaluate(gNull, facts({ utmKeyword: null })), true);
});

test("is on text is case-SENSITIVE exact match (mirrors SQL =)", () => {
  const g = group("and", [
    { field: "title", operator: "is", value: "ACME Corp" },
  ]);
  assert.equal(evaluate(g, facts({ title: "ACME Corp" })), true);
  // case-sensitive: "acme corp" must NOT match "ACME Corp"
  assert.equal(evaluate(g, facts({ title: "acme corp" })), false);
});

test("is_not on text is NULL-safe (is distinct from): null field is distinct", () => {
  const g = group("and", [
    { field: "title", operator: "is_not", value: "ACME Corp" },
  ]);
  assert.equal(evaluate(g, facts({ title: "Other" })), true);
  assert.equal(evaluate(g, facts({ title: "ACME Corp" })), false);
  // null IS DISTINCT FROM 'ACME Corp' => true
  assert.equal(evaluate(g, facts({ title: null })), true);
});

// --- Date semantics (Asia/Riyadh truncation) -------------------------------

test("date is matches the Riyadh-local date of the timestamp", () => {
  const g = group("and", [
    { field: "createdDate", operator: "is", value: "2026-07-05" },
  ]);
  // 2026-07-05T09:00:00Z => 12:00 Riyadh, same local date.
  assert.equal(
    evaluate(g, facts({ createdDate: new Date("2026-07-05T09:00:00Z") })),
    true,
  );
});

test("date truncation rolls over at Riyadh midnight, not UTC", () => {
  const g = group("and", [
    { field: "createdDate", operator: "is", value: "2026-07-06" },
  ]);
  // 2026-07-05T21:30:00Z => 2026-07-06 00:30 Riyadh (UTC+3): local date is the 6th.
  assert.equal(
    evaluate(g, facts({ createdDate: new Date("2026-07-05T21:30:00Z") })),
    true,
  );
  // ...and it is NOT the 5th anymore.
  const g5 = group("and", [
    { field: "createdDate", operator: "is", value: "2026-07-05" },
  ]);
  assert.equal(
    evaluate(g5, facts({ createdDate: new Date("2026-07-05T21:30:00Z") })),
    false,
  );
});

test("date gt / lt compare local dates", () => {
  const gt = group("and", [
    { field: "createdDate", operator: "gt", value: "2026-07-01" },
  ]);
  assert.equal(
    evaluate(gt, facts({ createdDate: new Date("2026-07-05T09:00:00Z") })),
    true,
  );
  const lt = group("and", [
    { field: "createdDate", operator: "lt", value: "2026-07-01" },
  ]);
  assert.equal(
    evaluate(lt, facts({ createdDate: new Date("2026-07-05T09:00:00Z") })),
    false,
  );
});

// --- between (inclusive both ends) -----------------------------------------

test("numeric between is inclusive of both ends", () => {
  const g = group("and", [
    { field: "value", operator: "between", value: [1000, 2000] },
  ]);
  assert.equal(evaluate(g, facts({ value: 1000 })), true); // low bound inclusive
  assert.equal(evaluate(g, facts({ value: 2000 })), true); // high bound inclusive
  assert.equal(evaluate(g, facts({ value: 1500 })), true);
  assert.equal(evaluate(g, facts({ value: 999 })), false);
  assert.equal(evaluate(g, facts({ value: 2001 })), false);
});

test("date between is inclusive range of local dates", () => {
  const g = group("and", [
    {
      field: "createdDate",
      operator: "between",
      value: ["2026-07-01", "2026-07-05"],
    },
  ]);
  assert.equal(
    evaluate(g, facts({ createdDate: new Date("2026-07-05T09:00:00Z") })),
    true,
  );
  assert.equal(
    evaluate(g, facts({ createdDate: new Date("2026-06-30T09:00:00Z") })),
    false,
  );
});

// --- Empty presence operators (ignore value) -------------------------------

test("is_empty on text: true when null or empty string", () => {
  const g = group("and", [{ field: "title", operator: "is_empty" }]);
  assert.equal(evaluate(g, facts({ title: null })), true);
  assert.equal(evaluate(g, facts({ title: "" })), true);
  assert.equal(evaluate(g, facts({ title: "x" })), false);
});

test("is_empty on non-text (owner id): true only when null", () => {
  const g = group("and", [{ field: "owner", operator: "is_empty" }]);
  assert.equal(evaluate(g, facts({ ownerId: null })), true);
  assert.equal(evaluate(g, facts({ ownerId: 7 })), false);
});

test("is_not_empty is the inverse and ignores value", () => {
  const g = group("and", [{ field: "utmKeyword", operator: "is_not_empty" }]);
  assert.equal(evaluate(g, facts({ utmKeyword: "x" })), true);
  assert.equal(evaluate(g, facts({ utmKeyword: "" })), false);
  assert.equal(evaluate(g, facts({ utmKeyword: null })), false);
});

// --- Edge cases ------------------------------------------------------------

test("empty group (EMPTY_FILTER) matches everything (vacuous)", () => {
  assert.equal(evaluate(EMPTY_FILTER, facts()), true);
  // an empty OR group also imposes no constraint (mirrors compileGroup -> undefined)
  assert.equal(evaluate(group("or", []), facts()), true);
});

test("a nested empty group contributes no constraint", () => {
  // status is open AND (empty) => governed solely by the status condition
  const g = group("and", [
    { field: "status", operator: "is", value: "open" },
    group("and", []),
  ]);
  assert.equal(evaluate(g, facts({ status: "open" })), true);
  assert.equal(evaluate(g, facts({ status: "won" })), false);
});

test("null fact value: is => false, gt => false", () => {
  const g = group("and", [{ field: "value", operator: "is", value: 100 }]);
  assert.equal(evaluate(g, facts({ value: null })), false);
  const gt = group("and", [{ field: "value", operator: "gt", value: 100 }]);
  assert.equal(evaluate(gt, facts({ value: null })), false);
});

test("id (stage) equality", () => {
  const g = group("and", [{ field: "stage", operator: "is", value: 3 }]);
  assert.equal(evaluate(g, facts({ stageId: 3 })), true);
  assert.equal(evaluate(g, facts({ stageId: 4 })), false);
});

test("id (pipeline) equality", () => {
  const g = group("and", [{ field: "pipeline", operator: "is", value: 1 }]);
  assert.equal(evaluate(g, facts({ pipelineId: 1 })), true);
  assert.equal(evaluate(g, facts({ pipelineId: 2 })), false);
});

test("id (pipeline) is_not", () => {
  const g = group("and", [{ field: "pipeline", operator: "is_not", value: 1 }]);
  assert.equal(evaluate(g, facts({ pipelineId: 2 })), true);
  assert.equal(evaluate(g, facts({ pipelineId: 1 })), false);
});

// --- Un-evaluable conditions THROW (the contract the write-time rule
// validation relies on: a value-less or field/operator-mismatched condition is
// rejected at rule-save time by dry-running the evaluator, so it can never
// abort a deal write at runtime).

test("throws when a value-taking text operator has an empty value", () => {
  const g = group("and", [
    { field: "title", operator: "contains", value: "" },
  ]);
  assert.throws(() => evaluate(g, facts()));
});

test("throws when a numeric operator has a missing value", () => {
  const g = group("and", [
    { field: "value", operator: "gt", value: undefined },
  ]);
  assert.throws(() => evaluate(g, facts()));
});

test("throws when a date operator has a missing value", () => {
  const g = group("and", [
    { field: "createdDate", operator: "is", value: undefined },
  ]);
  assert.throws(() => evaluate(g, facts()));
});

test("throws when between is not a two-value range", () => {
  const g = group("and", [
    { field: "value", operator: "between", value: 1000 },
  ]);
  assert.throws(() => evaluate(g, facts()));
});

test("throws when the operator is not valid for the field", () => {
  // `contains` is a text operator; it is not allowed on the numeric `value` field.
  const g = group("and", [
    { field: "value", operator: "contains", value: "x" },
  ]);
  assert.throws(() => evaluate(g, facts()));
});

test("does NOT throw for presence operators (no value needed)", () => {
  const g = group("and", [{ field: "title", operator: "is_empty" }]);
  assert.equal(evaluate(g, facts({ title: null })), true);
});

// --- List-only fields are not evaluable by rules --------------------------
// The deals-list filter DSL exposes fields the in-memory evaluator cannot
// resolve (joined/computed columns not present in DealFacts). Rule services
// dry-run `evaluate` at write time, so these MUST throw (→ 400) rather than
// silently match, guaranteeing a rule can only reference rule-capable fields.

test(
  "throws for a list-only field (organizationId) — not available to rules",
  () => {
  const g = group("and", [
    { field: "organizationId", operator: "is", value: 123 },
  ]);
  assert.throws(() => evaluate(g, facts()), /only available in deals-list/);
  },
);

test("throws for a list-only presence check (labels is_empty)", () => {
  const g = group("and", [{ field: "labels", operator: "is_empty" }]);
  assert.throws(() => evaluate(g, facts()), /only available in deals-list/);
});

