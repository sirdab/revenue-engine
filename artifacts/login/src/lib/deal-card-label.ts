// What a board card shows as a deal's name. Titles are often machine-made
// (Pipedrive's "<Org> Deal", web-form leads "<Name> - +9665…"), so the raw
// title spends the card's narrow width on noise: a trailing "Deal", a phone
// number, or an org name that the card already shows right under it. This keeps the title as stored and only cleans the label.

export type DealCardLabel = {
  /** The cleaned name, or the org/person when the title held nothing else. */
  primary: string;
  /** Org (or person) shown under the name; null when it would repeat it. */
  secondary: string | null;
};

// 9+ digits, optionally with a leading + and spaces/dashes inside: a phone
// number, never a short code like "ACME400" or "2000 sqm".
const PHONE = /\+?\d(?:[\s-]?\d){8,}/g;
const EDGE_SEPARATORS = /^[\s\-—–|:,·]+|[\s\-—–|:,·]+$/g;

export function cleanDealTitle(title: string): string {
  return title
    .replace(PHONE, " ")
    .replace(/^\s*company name\s*:\s*/i, "")
    .replace(/\s+/g, " ")
    .replace(EDGE_SEPARATORS, "")
    .replace(/\s+deal$/i, "")
    .replace(EDGE_SEPARATORS, "")
    .trim();
}

const norm = (s: string) =>
  cleanDealTitle(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

export function dealCardLabel(deal: {
  title: string;
  organizationName?: string | null;
  personName?: string | null;
}): DealCardLabel {
  const org = deal.organizationName?.trim() || null;
  const person = deal.personName?.trim() || null;
  const cleaned = cleanDealTitle(deal.title);
  // A title that was only a phone number (or only "Deal") says nothing; name
  // the card after who the deal is with instead.
  const primary = cleaned || org || person || deal.title.trim();
  const secondary = [org, person].find((s) => s && norm(s) !== norm(primary));
  return { primary, secondary: secondary ?? null };
}
