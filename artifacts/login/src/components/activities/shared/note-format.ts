// Pure helpers the shared activity dialogs lean on. Plain .ts on purpose:
// node:test loads it without a DOM or a bundler.
//
// Activity notes are HTML from the rich editor (TipTap); older notes imported
// from Pipedrive may be plain text in that same column.

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Plain text as one HTML paragraph, line breaks kept. */
export function plainToHtml(text: string): string {
  return `<p>${escapeHtml(text).replace(/\r?\n/g, "<br>")}</p>`;
}

function looksLikeHtml(note: string): boolean {
  return /^\s*</.test(note);
}

/**
 * Their response joins the existing note rather than replacing it: the note
 * often holds the plan ("ask about the renewal"), and the answer belongs
 * under it. `response` is the editor's HTML.
 *
 * A note that is still legacy plain text is escaped into a paragraph first, so a stray "<" in an old note can never turn into markup when the
 * two are joined.
 */
export function appendResponse(
  note: string | null | undefined,
  response: string,
): string {
  const existing = note?.trim() ?? "";
  if (!existing) return response;
  return (looksLikeHtml(existing) ? existing : plainToHtml(existing)) + response;
}

/**
 * Whether "No reply" is offered on an activity: mirrors the server's
 * noReplyRefusal (api-server/src/lib/activity-outcome.ts) so the button is
 * never shown where the server would refuse it. Only open, posted contact
 * work can go unanswered.
 */
export function canMarkNoReply(
  a: { done: boolean; type: string; draft?: boolean },
  contactTypes: readonly string[],
): boolean {
  return !a.done && !a.draft && contactTypes.includes(a.type);
}
