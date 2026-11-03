export type AssistantRecordType =
  | "deal"
  | "person"
  | "organization"
  | "activity"
  | "note";

export type AssistantScoreBand = "high" | "medium" | "low";

export interface AssistantSearchCandidate {
  recordType: AssistantRecordType;
  recordId: number;
  title: string;
  matchedField: string;
  snippet: string;
  relatedName: string | null;
  href: string;
  timestamp: Date | null;
  ownerName: string | null;
  score: number;
  scoreBand: AssistantScoreBand;
}

export interface CandidateForScoring extends AssistantSearchCandidate {
  searchTexts: string[];
}

export function normalizeAssistantText(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    // Arabic normalization, so Arabic names match loosely. Drop tashkeel (harakat),
    // the superscript alef, and tatweel; fold the alef / alef-maqsura /
    // ta-marbuta variants so e.g. "الراجحى" and "الراجحي" resolve to the same
    // form. Without this, Arabic names only matched byte-for-byte.
    .replace(/[ً-ْٰـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim();
}

export function compactAssistantText(value: string | null | undefined): string {
  // Keep any Unicode letter/number (Arabic + Latin), drop only separators and
  // punctuation. The old `[^a-z0-9]` class deleted every Arabic character, so
  // Arabic queries compacted to "" and lost the entire fuzzy/compact match path.
  return normalizeAssistantText(value).replace(/[^\p{L}\p{N}]+/gu, "");
}

export function tokenizeAssistantText(value: string | null | undefined): string[] {
  return Array.from(
    new Set(
      normalizeAssistantText(value)
        .split(/[^\p{L}\p{N}]+/u)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2),
    ),
  );
}

function bigrams(value: string): string[] {
  if (value.length < 2) return value ? [value] : [];
  const out: string[] = [];
  for (let i = 0; i < value.length - 1; i++) out.push(value.slice(i, i + 2));
  return out;
}

export function bigramDice(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const as = bigrams(a);
  const bs = bigrams(b);
  if (!as.length || !bs.length) return 0;
  const counts = new Map<string, number>();
  for (const g of as) counts.set(g, (counts.get(g) ?? 0) + 1);
  let overlap = 0;
  for (const g of bs) {
    const n = counts.get(g) ?? 0;
    if (n > 0) {
      overlap++;
      counts.set(g, n - 1);
    }
  }
  return (2 * overlap) / (as.length + bs.length);
}

function scoreBand(score: number): AssistantScoreBand {
  if (score >= 220) return "high";
  if (score >= 120) return "medium";
  return "low";
}

function exactTokenCoverage(tokens: string[], haystack: string): boolean {
  if (!tokens.length) return false;
  return tokens.every((token) => haystack.includes(token));
}

export function scoreAssistantCandidate(
  query: string,
  candidate: Pick<CandidateForScoring, "recordId" | "recordType" | "matchedField" | "searchTexts">,
): number {
  const normalized = normalizeAssistantText(query);
  const compact = compactAssistantText(query);
  const tokens = tokenizeAssistantText(query);
  let best = 0;

  if (/^\d+$/.test(normalized) && Number(normalized) === candidate.recordId) {
    best = 360;
  }

  for (const rawText of candidate.searchTexts) {
    const text = normalizeAssistantText(rawText);
    const compactText = compactAssistantText(rawText);
    let score = 0;
    if (compact && compactText && compactText === compact) score = 280;
    else if (normalized && text === normalized) score = 250;
    else if (compact && compactText.startsWith(compact)) score = 220;
    else if (exactTokenCoverage(tokens, text)) score = 180;
    else if (compact && compactText.includes(compact)) score = 145;
    else if (normalized && text.includes(normalized)) score = 130;
    else if (compact) {
      const dice = bigramDice(compact, compactText);
      if (dice >= 0.78) score = 115;
      else if (dice >= 0.62) score = 85;
    }

    // "Person"/"Organization" here mean a deal matched via its LINKED
    // contact/org name (a join onto another table), not the deal's own
    // field — that's a weaker signal than a record's own identity field, so
    // it shouldn't get the same bonus as "Title"/"Name"/"Phone" or a deal
    // ends up scored on par with (or above) the very person/org it merely
    // references.
    const isLinkedEntityField = /^(person|organization)$/i.test(candidate.matchedField);
    if (
      score > 0 &&
      !isLinkedEntityField &&
      /(title|name|company|organization|person|phone)/i.test(candidate.matchedField)
    ) {
      score += 25;
    } else if (score > 0 && /(note|comments)/i.test(candidate.matchedField)) {
      score -= 20;
    }

    // Likewise, only nudge a deal ahead of other record types when the
    // deal's OWN title matched — a deal that surfaced through a linked
    // org/person shouldn't outrank that other record's own match either.
    if (candidate.recordType === "deal" && candidate.matchedField === "Title") score += 10;
    if (candidate.recordType === "organization") score += 6;

    if (score > best) best = score;
  }

  return best;
}

export function rankAssistantCandidates(
  query: string,
  candidates: CandidateForScoring[],
): AssistantSearchCandidate[] {
  return candidates
    .map((candidate) => {
      const score = scoreAssistantCandidate(query, candidate);
      return { ...candidate, score, scoreBand: scoreBand(score) };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aTime = a.timestamp?.getTime() ?? 0;
      const bTime = b.timestamp?.getTime() ?? 0;
      if (bTime !== aTime) return bTime - aTime;
      return a.title.localeCompare(b.title);
    })
    .map(({ searchTexts: _searchTexts, ...candidate }) => candidate);
}
