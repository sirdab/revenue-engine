import { test } from "node:test";
import assert from "node:assert/strict";
import { ownerChangeAllowed } from "./deal-reassign";

const rep = { isAdmin: false, ownerChanged: true };

test("a rep may reassign when no pipeline involved is locked", () => {
  assert.equal(ownerChangeAllowed({ ...rep, lockedPipelines: [false] }), true);
  assert.equal(
    ownerChangeAllowed({ ...rep, lockedPipelines: [false, false] }),
    true,
  );
});

test("a rep may not reassign in a locked pipeline", () => {
  assert.equal(ownerChangeAllowed({ ...rep, lockedPipelines: [true] }), false);
});

test("a locked pipeline on either side of a move refuses an owner change", () => {
  // Leaving a locked pipeline under a new owner.
  assert.equal(
    ownerChangeAllowed({ ...rep, lockedPipelines: [true, false] }),
    false,
  );
  // Arriving in a locked pipeline under a new owner.
  assert.equal(
    ownerChangeAllowed({ ...rep, lockedPipelines: [false, true] }),
    false,
  );
});

test("an unchanged owner is always allowed, locked or not", () => {
  assert.equal(
    ownerChangeAllowed({
      isAdmin: false,
      ownerChanged: false,
      lockedPipelines: [true, true],
    }),
    true,
  );
});

test("an admin may always reassign", () => {
  assert.equal(
    ownerChangeAllowed({
      isAdmin: true,
      ownerChanged: true,
      lockedPipelines: [true, true],
    }),
    true,
  );
});

test("a bulk selection with one locked deal refuses the whole change", () => {
  assert.equal(
    ownerChangeAllowed({ ...rep, lockedPipelines: [false, false, true] }),
    false,
  );
});
