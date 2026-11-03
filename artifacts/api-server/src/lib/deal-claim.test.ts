import { test } from "node:test";
import assert from "node:assert/strict";

// deal-claim.ts imports `@workspace/db`, which throws without a DATABASE_URL;
// the decision under test never touches it.
process.env.DATABASE_URL ??= "postgres://deal-claim-test/unused";
const { shouldClaimDeal } = await import("./deal-claim");

test("the first person to act on an untouched deal takes it", () => {
  assert.equal(shouldClaimDeal({ ownerId: 1, archived: false }, 2, false), true);
  assert.equal(shouldClaimDeal({ ownerId: null, archived: false }, 2, false), true);
});

test("a deal a person already worked on stays with its owner", () => {
  assert.equal(shouldClaimDeal({ ownerId: 1, archived: false }, 2, true), false);
});

test("the owner logging the first activity is not a change", () => {
  assert.equal(shouldClaimDeal({ ownerId: 2, archived: false }, 2, false), false);
});

test("an archived deal never changes hands", () => {
  assert.equal(shouldClaimDeal({ ownerId: 1, archived: true }, 2, false), false);
});
