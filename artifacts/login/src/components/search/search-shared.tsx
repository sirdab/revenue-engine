import React from "react";
import {
  Briefcase,
  Building2,
  CalendarCheck,
  Paperclip,
  StickyNote,
  User,
} from "lucide-react";
import { formatRelativeLong } from "@/lib/format";
import type { MessageKey, Translate } from "@/lib/i18n/i18n";

// Shared between the ⌘K palette (global-search.tsx) and the full results page
// (pages/search.tsx) so the two surfaces render matches identically.

export const RECORD_ICON: Record<
  string,
  React.ComponentType<{ className?: string }>
> = {
  deal: Briefcase,
  person: User,
  organization: Building2,
  activity: CalendarCheck,
  note: StickyNote,
  file: Paperclip,
};

// Wrap every case-insensitive occurrence of `term` in <mark> so the user can
// see exactly what matched inside the value snippet.
//
// Plain runs are wrapped in <span> rather than left as bare text nodes. This
// re-renders on every keystroke, and when browser translation (Chrome on iOS
// especially) has swapped those text nodes out, React's removeChild finds
// nothing and the app crashes with "NotFoundError: The object can not be found
// here". React reliably removes elements.
export function Highlight({ text, term }: { text: string; term: string }) {
  const needle = term.trim().toLowerCase();
  const lower = text.toLowerCase();
  // Case-folding can change a string's length (e.g. "İ" lowercases to two code
  // units), which would shift every index below; prefer no highlight over
  // marking the wrong range.
  if (!needle || lower.length !== text.length) return <span>{text}</span>;
  const parts: React.ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < text.length) {
    const idx = lower.indexOf(needle, i);
    if (idx < 0) {
      parts.push(<span key={key++}>{text.slice(i)}</span>);
      break;
    }
    if (idx > i) parts.push(<span key={key++}>{text.slice(i, idx)}</span>);
    parts.push(
      <mark key={key++} className="rounded bg-brand-subtle px-0.5 text-brand">
        {text.slice(idx, idx + needle.length)}
      </mark>,
    );
    i = idx + needle.length;
  }
  return <>{parts}</>;
}

export function relativeTime(
  ts: string | Date | null | undefined,
): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return formatRelativeLong(d);
}

// "6" for a complete group, "6+" for one truncated at the per-type cap.
export function countLabel(count: number, hasMore?: boolean): string {
  return hasMore ? `${count}+` : `${count}`;
}

export type SearchScope =
  | "all"
  | "deal"
  | "person"
  | "organization"
  | "activity"
  | "note"
  | "file";

// Keep in sync with SearchRecordType in artifacts/api-server/src/lib/search.ts.
export const SEARCH_SCOPES: { value: SearchScope; label: MessageKey }[] = [
  { value: "all", label: "common.all" },
  { value: "deal", label: "common.deals" },
  { value: "person", label: "deals.related.people" },
  { value: "organization", label: "contacts.organizations" },
  { value: "activity", label: "common.activities" },
  { value: "note", label: "common.notes" },
  { value: "file", label: "search.scope.attachments" },
];

/** The translated heading for a result group. The server sends an English
 *  `label` per group; the client re-derives it from the record type. */
export function scopeLabel(t: Translate, recordType: string, fallback: string): string {
  const scope = SEARCH_SCOPES.find((s) => s.value === recordType);
  return scope ? t(scope.label) : fallback;
}

// The generated useSearch({ q, types }) hook takes `types` as a single
// comma-separated string (see lib/api-spec/openapi.yaml); "all" means "omit
// the param and search everything".
export function scopeToTypesParam(scope: SearchScope): string | undefined {
  return scope === "all" ? undefined : scope;
}

export function typesParamToScope(
  types: string | null | undefined,
): SearchScope {
  if (!types || types === "all") return "all";
  const exact = SEARCH_SCOPES.find((s) => s.value === types);
  return exact?.value ?? "all";
}
