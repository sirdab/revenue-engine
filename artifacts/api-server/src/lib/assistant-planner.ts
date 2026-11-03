import type {
  AssistantRecordType,
  AssistantSearchCandidate,
} from "./assistant-search-ranking.ts";
import {
  compactAssistantText,
  normalizeAssistantText,
  tokenizeAssistantText,
} from "./assistant-search-ranking.ts";

export type AssistantIntent =
  | "deal_owner"
  | "deal_status"
  | "notes_summary"
  | "company_snapshot"
  | "pipeline_summary"
  | "my_deals_list"
  | "record_lookup";

export interface AssistantQueryPlan {
  rawQuery: string;
  normalizedQuery: string;
  searchQuery: string;
  fallbackSearchQuery: string | null;
  recordTypes?: AssistantRecordType[];
  intent: AssistantIntent;
  directDealId?: number;
  mentionsCurrentUser: boolean;
  /** Only meaningful when intent is "my_deals_list". */
  myDealsStatus?: "open" | "won" | "lost";
}

export type CandidateResolution =
  | { kind: "none" }
  | { kind: "resolved"; candidate: AssistantSearchCandidate }
  | { kind: "ambiguous"; candidates: AssistantSearchCandidate[] };

const PREFIX_PATTERNS: RegExp[] = [
  /^(what(?:'s| is)? the status of)\s+/i,
  /^(who is handling)\s+/i,
  /^(who owns)\s+/i,
  /^(who'?s handling)\s+/i,
  /^(what notes should i know about)\s+/i,
  /^(what should i know about)\s+/i,
  /^(tell me about)\s+/i,
  /^(summari[sz]e)\s+/i,
  /^(show me)\s+/i,
  /^(look up)\s+/i,
  /^(lookup)\s+/i,
  /^(find)\s+/i,
  /^(search for)\s+/i,
  /^(give me)\s+/i,
];

const NOISE_PATTERNS: RegExp[] = [
  /\bplease\b/gi,
  /\bright now\b/gi,
  /\bthat deal\b/gi,
];

function stripPunctuation(value: string): string {
  return value.replace(/[?!.,]+$/g, "").trim();
}

function stripPrefixes(value: string): string {
  let out = value.trim();
  for (const pattern of PREFIX_PATTERNS) out = out.replace(pattern, "");
  return out.trim();
}

function stripNoise(value: string): string {
  let out = value;
  for (const pattern of NOISE_PATTERNS) out = out.replace(pattern, " ");
  out = out.replace(/\bdeal\b/gi, " ");
  out = out.replace(/\s+/g, " ").trim();
  return out;
}

function trimAtConnector(value: string): string {
  const connectors = [
    " about ",
    " for ",
    " regarding ",
    " on ",
  ];
  for (const connector of connectors) {
    const idx = value.toLowerCase().indexOf(connector);
    if (idx > 0) return value.slice(0, idx).trim();
  }
  return value.trim();
}

// Generic words a "list my deals" request reduces to once prefixes ("tell me
// about", "show me") and the standalone word "deal" are stripped by
// extractAssistantSearchQuery's stripNoise step. If anything else survives
// (a company/person name, a deal id), it's a specific lookup, not a list
// request — e.g. "my deal with Northwind" keeps "northwind" and falls through.
const MY_DEALS_FILLER_TOKENS = new Set([
  "my",
  "me",
  "deal",
  "deals",
  "open",
  "all",
  "active",
  "current",
  "won",
  "lost",
]);

/**
 * True for a generic "list my own deals" request ("my deals", "show me my
 * open deals", "list my won deals") as opposed to a specific lookup ("tell
 * me about my deal with Northwind") — the latter has a real entity name left
 * over after stripping prefixes/filler, this doesn't.
 */
function isMyDealsListQuery(query: string, normalized: string): boolean {
  if (!/\bme\b|\bmy\b/.test(normalized)) return false;
  const { searchQuery } = extractAssistantSearchQuery(query);
  const tokens = tokenizeAssistantText(searchQuery);
  if (!tokens.length) return false;
  return (
    tokens.some((token) => token === "deal" || token === "deals") &&
    tokens.every((token) => MY_DEALS_FILLER_TOKENS.has(token))
  );
}

// Every alternation below is wrapped in its own group — `/\ba|b\b/` only
// binds `\b` to the first/last alternative, so `b` (and everything between)
// would match as a bare substring anywhere. `/\b(a|b)\b/` is the fix, applied
// throughout this file.
export function inferAssistantIntent(query: string): AssistantIntent {
  const normalized = normalizeAssistantText(query);

  // Most-specific intents first: a generic word like "stage" showing up in
  // an otherwise clearly deal-specific question ("who's handling the deal in
  // the negotiation stage") must not get stolen by the pipeline-wide intent
  // just because it scans for "stage" too.
  if (/\b(who)\b/.test(normalized) && /\b(handling|owner|owns|owned)\b/.test(normalized)) {
    return "deal_owner";
  }
  // Keywords tolerate an optional plural `s` — a word-boundaried `\bpipeline\b`
  // does NOT match "pipelines" (the trailing `s` is a word char), so the plural
  // phrasing a user actually types ("list the pipelines", "what stages") would
  // silently lose its whole intent and fall back to a junk record_lookup.
  if (
    /\b(status|stages?)\b/.test(normalized) &&
    !/\b(pipelines?|boards?|overall|all deals|every deal)\b/.test(normalized)
  ) {
    return "deal_status";
  }
  if (/\b(pipelines?|boards?)\b/.test(normalized)) return "pipeline_summary";
  if (/\b(note|notes)\b/.test(normalized)) return "notes_summary";
  // Checked before company_snapshot: "tell me about my deals" would
  // otherwise match the "tell me about" prefix below and route into a
  // company-lookup flow that searches for the literal text "my deals" —
  // that search matches nothing, wasting a bootstrap tool call and leaving
  // the model to reconstruct the actual list_deals lookup itself.
  if (isMyDealsListQuery(query, normalized)) return "my_deals_list";
  if (/\b(what should i know about|tell me about)\b/.test(normalized)) {
    return "company_snapshot";
  }
  return "record_lookup";
}

function inferMyDealsStatus(normalized: string): "open" | "won" | "lost" {
  if (/\bwon\b/.test(normalized)) return "won";
  if (/\blost\b/.test(normalized)) return "lost";
  return "open";
}

export function inferAssistantRecordTypes(
  query: string,
  intent: AssistantIntent,
): AssistantRecordType[] | undefined {
  if (intent === "pipeline_summary" || intent === "my_deals_list") return ["deal"];
  if (intent === "deal_owner" || intent === "deal_status") {
    return ["deal", "organization", "person"];
  }
  if (intent === "notes_summary" || intent === "company_snapshot") {
    return ["organization", "deal", "person", "note", "activity"];
  }
  if (/\b(phone|call)\b/.test(normalizeAssistantText(query))) return ["person"];
  return ["organization", "deal", "person", "note", "activity"];
}

export function extractAssistantSearchQuery(query: string): {
  searchQuery: string;
  fallbackSearchQuery: string | null;
} {
  const stripped = stripPunctuation(stripPrefixes(query));
  const withoutNoise = stripNoise(stripped);
  const normalized = normalizeAssistantText(withoutNoise);

  const aboutIdx = normalized.indexOf("about ");
  if (aboutIdx >= 0) {
    const tail = withoutNoise.slice(aboutIdx + 6).trim();
    const exact = trimAtConnector(tail);
    return {
      searchQuery: exact || withoutNoise || stripped || query.trim(),
      fallbackSearchQuery: exact && exact !== withoutNoise ? withoutNoise : null,
    };
  }

  const statusMatch = /\bstatus of\s+(.+)$/i.exec(stripped);
  if (statusMatch?.[1]) {
    const exact = stripNoise(statusMatch[1]);
    return { searchQuery: exact || statusMatch[1].trim(), fallbackSearchQuery: null };
  }

  const ownerMatch = /\bhandling\s+(.+)$/i.exec(stripped);
  if (ownerMatch?.[1]) {
    const exact = stripNoise(ownerMatch[1]);
    return { searchQuery: exact || ownerMatch[1].trim(), fallbackSearchQuery: null };
  }

  const compactTokens = tokenizeAssistantText(withoutNoise);
  const exact = withoutNoise || stripped || query.trim();
  const fallback =
    compactTokens.length >= 2 ? compactTokens.slice(0, 2).join(" ") : null;
  return {
    searchQuery: exact,
    fallbackSearchQuery: fallback && normalizeAssistantText(fallback) !== normalizeAssistantText(exact)
      ? fallback
      : null,
  };
}

// A bare 2+-digit number appears in almost any real question (quantities,
// prices, years) — treating every one as a deal id was a real bug (e.g. "how
// much for 30 units" or "the deal worth 45000" or "pipeline for 2026" all
// extracted a "deal id"). Only treat it as a direct deal-id reference when the
// whole message IS just a number, or a number is immediately next to an
// explicit marker word ("deal", "id").
function extractDirectDealId(query: string): number | undefined {
  // Bound the digit run — no real deal id is anywhere near 10 digits — so a
  // pathological number in the message can't overflow Number() into
  // Infinity or an imprecise float. isSafeInteger is a backstop on top.
  const whole = /^\s*#?(\d{2,10})\s*$/.exec(query);
  const marker = /\b(?:deal|id)\s*#?\s*(\d{2,10})\b/i.exec(query);
  const raw = whole?.[1] ?? marker?.[1];
  if (!raw) return undefined;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : undefined;
}

export function analyzeAssistantQuery(query: string): AssistantQueryPlan {
  const normalizedQuery = normalizeAssistantText(query);
  const intent = inferAssistantIntent(query);
  const { searchQuery, fallbackSearchQuery } = extractAssistantSearchQuery(query);

  return {
    rawQuery: query,
    normalizedQuery,
    searchQuery,
    fallbackSearchQuery,
    recordTypes: inferAssistantRecordTypes(query, intent),
    intent,
    directDealId: extractDirectDealId(query),
    myDealsStatus: intent === "my_deals_list" ? inferMyDealsStatus(normalizedQuery) : undefined,
    mentionsCurrentUser: mentionsCurrentUser(normalizedQuery),
  };
}

// "show me / give me / tell me the pipeline" is a DISPLAY verb, not ownership —
// treating the bare "me" as ownership scoped the whole-pipeline answer down to
// just the current user's deals. Ownership needs a possessive ("my"/"mine") or a
// "me" that isn't the object of a display verb (e.g. "deals assigned to me").
function mentionsCurrentUser(normalized: string): boolean {
  if (/\b(my|mine)\b/.test(normalized)) return true;
  if (!/\bme\b/.test(normalized)) return false;
  return !/\b(show|give|tell|remind|get)\s+me\b/.test(normalized);
}

export function resolveAssistantCandidates(
  candidates: AssistantSearchCandidate[],
): CandidateResolution {
  const top = candidates[0];
  if (!top) return { kind: "none" };

  // A low-band top means nothing actually matched well. Don't hand the model a
  // weak guess as an authoritative match, and don't ask the user to choose
  // between two equally-weak non-matches — report nothing and let Claude run
  // its own search from scratch (a missing bootstrap hint is merely wasted
  // pre-fetch, whereas a confident non-match reaches the user as fact).
  if (top.scoreBand === "low") return { kind: "none" };

  const second = candidates[1];
  const topScore = top.score ?? 0;
  const secondScore = second?.score ?? 0;
  const scoreGap = topScore - secondScore;

  // A runaway-high absolute score wins outright — unless the runner-up is
  // ALSO runaway-high and close behind (e.g. two records with an identical
  // exact-name match can both clear 300): that's a genuine tie, not a clear
  // win, so it falls through to the ambiguous path below instead of
  // silently picking whichever sorted first.
  if (topScore >= 300 && (secondScore < 300 || scoreGap >= 45)) {
    return { kind: "resolved", candidate: top };
  }

  // Otherwise the top is a confident single match only when it clears the
  // runner-up by a solid margin, or the runner-up is itself a weak (low-band)
  // match. The gap boundary is the same (45) for high- and medium-band tops —
  // the previous medium-only `>= 80` branch was dead code (a medium top with a
  // 45–80 gap fell through to an unconditional resolve anyway).
  const secondIsWeak = !second || second.scoreBand === "low";
  if (topScore < 300 && (scoreGap >= 45 || secondIsWeak)) {
    return { kind: "resolved", candidate: top };
  }

  // Two comparably-strong candidates within 45 points — ask which one.
  return { kind: "ambiguous", candidates: candidates.slice(0, 3) };
}

export function buildAssistantClarification(
  query: string,
  candidates: AssistantSearchCandidate[],
): string {
  const subject = compactAssistantText(query) || "that";
  const lines = candidates.slice(0, 3).map((candidate, index) => {
    const related = candidate.relatedName ? ` - ${candidate.relatedName}` : "";
    return `${index + 1}. ${candidate.title} (${candidate.recordType}${related})`;
  });
  return [
    `I found a few plausible matches for "${subject}". Which one did you mean?`,
    ...lines,
  ].join("\n");
}
