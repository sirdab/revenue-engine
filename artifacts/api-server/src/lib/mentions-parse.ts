// Pure, dependency-free @mention parsing — no DB import, so it is unit-testable
// under `node --test` without a database (the file-validation.ts precedent).
//
// The rich note editor embeds mentions as `<span data-mention="<userId>">…`
// chips inside the note's stored HTML. This is the FROZEN contract that both
// the legacy hand-rolled editor and the TipTap editor must emit — the CI
// characterization test in mentions-parse.test.ts locks it.

export const MENTION_RE = /data-mention="(\d+)"/g;

export function extractMentionUserIds(
  html: string | null | undefined,
): number[] {
  if (!html) return [];
  const ids = new Set<number>();
  for (const match of html.matchAll(MENTION_RE)) {
    const id = Number(match[1]);
    if (Number.isInteger(id) && id > 0) ids.add(id);
  }
  return [...ids];
}
