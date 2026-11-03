import { test } from "node:test";
import assert from "node:assert/strict";
import { extractMentionUserIds } from "./mentions-parse.ts";

// Characterization of the FROZEN @mention HTML contract (R7). `MENTION_RE`
// parses raw stored HTML, so the TipTap editor's custom Mention renderHTML must
// keep emitting `data-mention="<userId>"`. If TipTap ever regresses to its
// default `data-id` markup, these fail and the mention pipeline breaks silently
// everywhere at once. No DB access — pure, CI-runnable.

// The exact markup the legacy hand-rolled editor stored.
const legacyChip = (id: number, name: string) =>
  `<span data-mention="${id}" contenteditable="false" class="rounded bg-teal-50 px-1 font-medium text-teal-700">@${name}</span>`;

// The exact markup TipTap's custom Mention renderHTML emits (attribute order
// mirrors rich-note-editor.tsx: data-mention, contenteditable, class).
const tiptapChip = (id: number, name: string) =>
  `<span data-mention="${id}" contenteditable="false" class="rounded bg-teal-50 px-1 font-medium text-teal-700">@${name}</span>`;

test("extractMentionUserIds: legacy chip HTML", () => {
  const html = `<div>Hey ${legacyChip(7, "Sara")} please review</div>`;
  assert.deepEqual(extractMentionUserIds(html), [7]);
});

test("extractMentionUserIds: TipTap-emitted chip HTML yields the same ids", () => {
  const html = `<p>Hey ${tiptapChip(7, "Sara")} please review</p>`;
  assert.deepEqual(extractMentionUserIds(html), [7]);
});

test("extractMentionUserIds: legacy and TipTap markup agree for multiple mentions", () => {
  const legacy = `<div>${legacyChip(3, "Ali")} and ${legacyChip(9, "Noor")}</div>`;
  const tiptap = `<p>${tiptapChip(3, "Ali")} and ${tiptapChip(9, "Noor")}</p>`;
  assert.deepEqual(extractMentionUserIds(legacy), extractMentionUserIds(tiptap));
  assert.deepEqual(extractMentionUserIds(tiptap), [3, 9]);
});

test("extractMentionUserIds: de-duplicates repeated mentions of the same user", () => {
  const html = `${tiptapChip(5, "Zed")} ... ${tiptapChip(5, "Zed")}`;
  assert.deepEqual(extractMentionUserIds(html), [5]);
});

test("extractMentionUserIds: empty / null / no-mention inputs → []", () => {
  assert.deepEqual(extractMentionUserIds(null), []);
  assert.deepEqual(extractMentionUserIds(undefined), []);
  assert.deepEqual(extractMentionUserIds(""), []);
  assert.deepEqual(extractMentionUserIds("<p>no mentions here</p>"), []);
});

test("extractMentionUserIds: ignores non-numeric / zero ids", () => {
  // A malformed chip must never yield a bogus recipient.
  assert.deepEqual(
    extractMentionUserIds(`<span data-mention="0">@x</span>`),
    [],
  );
  assert.deepEqual(
    extractMentionUserIds(`<span data-mention="abc">@x</span>`),
    [],
  );
});

test("extractMentionUserIds: legacy content with &nbsp;/<br> around a chip still parses", () => {
  const html = `<div>&nbsp;${legacyChip(42, "Omar")}<br>done</div>`;
  assert.deepEqual(extractMentionUserIds(html), [42]);
});
