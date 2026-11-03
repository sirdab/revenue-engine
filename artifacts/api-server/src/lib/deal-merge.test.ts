import { test } from "node:test";
import assert from "node:assert/strict";
import type { Deal } from "@workspace/db";

// Importing deal-merge pulls in `@workspace/db`, which refuses to load without
// a DATABASE_URL; assertMergeable is pure and opens no connection, hence the
// env stub before the dynamic import (same shape as deals-where.test.ts).
process.env.DATABASE_URL ??= "postgres://deal-merge-test/unused";
const { assertMergeable, DealMergeError } = await import("./deal-merge.ts");

function deal(over: Partial<Deal> & { id: number }): Deal {
  return {
    title: "A deal",
    archived: false,
    status: "open",
    mergedIntoDealId: null,
    ...over,
  } as Deal;
}

/** The DealMergeError a merge of these two throws, or null if it's allowed. */
function refusal(primary: Deal, duplicate: Deal) {
  try {
    assertMergeable(primary, duplicate);
    return null;
  } catch (err) {
    assert.ok(err instanceof DealMergeError, `unexpected error: ${String(err)}`);
    return err;
  }
}

test("a clean pair merges", () => {
  assert.equal(refusal(deal({ id: 1 }), deal({ id: 2 })), null);
});

test("a deal cannot be merged into itself", () => {
  const err = refusal(deal({ id: 7 }), deal({ id: 7 }));
  assert.equal(err?.status, 400);
});

test("an already-merged source is refused, named by title and survivor", () => {
  const err = refusal(
    deal({ id: 1, title: "سراج الاطعمه Deal" }),
    deal({ id: 2, title: "Siraj Al Atmah Deal", mergedIntoDealId: 35992 }),
  );
  assert.equal(err?.status, 409);
  assert.match(err.message, /Siraj Al Atmah Deal/);
  assert.match(err.message, /#35992/);
});

test("an already-merged target is refused, named by title and survivor", () => {
  const err = refusal(
    deal({ id: 2, title: "Siraj Al Atmah Deal", mergedIntoDealId: 35992 }),
    deal({ id: 1, title: "سراج الاطعمه Deal" }),
  );
  assert.equal(err?.status, 409);
  assert.match(err.message, /Siraj Al Atmah Deal/);
  assert.match(err.message, /#35992/);
});

// The regression this guard's wording exists for: "duplicate" and "primary"
// are this module's vocabulary. A user reading the toast sees two deals and no
// way to map those words onto them, so the message read as a complaint about
// whichever deal they had just picked — and sent them looking at the wrong one.
test("no refusal leaks the merge's internal role vocabulary", () => {
  const merged = deal({ id: 2, title: "Merged away", mergedIntoDealId: 35992 });
  const archived = deal({ id: 3, title: "Old deal", archived: true });
  const deleted = deal({ id: 4, title: "Gone", status: "deleted" });
  const clean = deal({ id: 1, title: "Live deal" });

  const messages = [
    refusal(clean, merged),
    refusal(merged, clean),
    refusal(clean, archived),
    refusal(archived, clean),
    refusal(clean, deleted),
    refusal(deleted, clean),
  ].map((e) => {
    assert.ok(e, "expected a refusal");
    return e.message;
  });

  for (const m of messages) {
    assert.doesNotMatch(m, /\bduplicate\b/i, m);
    assert.doesNotMatch(m, /\bprimary\b/i, m);
    // Every refusal must name the deal it is about.
    assert.match(m, /“[^”]+”/, m);
  }
});

test("an empty title falls back to the deal number", () => {
  const err = refusal(deal({ id: 1 }), deal({ id: 2, title: "", mergedIntoDealId: 9 }));
  assert.match(err!.message, /Deal #2/);
});
