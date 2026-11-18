import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "./use-deals-url-state";

// The "Archive" tab is gone, but ?view=archive is durable: it lives in
// bookmarks, shared links, saved views (deal_views.definition) and the
// deals.lastState preference. None of those are migrated, so the translation
// below is the only thing keeping those links from silently landing on an
// open-only list — which would look like the user's won/lost deals vanished.

test("a legacy ?view=archive URL lands on the list with the All status lens", () => {
  const state = parse("view=archive");
  assert.equal(state.view, "list");
  assert.equal(state.status, "all");
});

test("an explicit status in a legacy URL wins over the translation", () => {
  assert.equal(parse("view=archive&status=won").status, "won");
});

test("a legacy archive URL keeps its other params", () => {
  const state = parse("view=archive&pipelineId=3&ownerId=7&q=acme");
  assert.equal(state.pipelineId, 3);
  assert.equal(state.ownerId, 7);
  assert.equal(state.q, "acme");
});

// The archived lens is a separate control and must not be switched on by the
// status translation — "All" means all statuses, not all archived deals.
test("translating a legacy archive URL leaves the archived lens off", () => {
  assert.equal(parse("view=archive").archived, undefined);
});

test("an ordinary list URL keeps the open-only default (no status param)", () => {
  assert.equal(parse("view=list").status, undefined);
});

test("an unknown view falls back to the list without a status lens", () => {
  const state = parse("view=nonsense");
  assert.equal(state.view, "list");
  assert.equal(state.status, undefined);
});
