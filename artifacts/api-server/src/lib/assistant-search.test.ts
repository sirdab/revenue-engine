import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeAssistantText,
  compactAssistantText,
  tokenizeAssistantText,
  bigramDice,
  scoreAssistantCandidate,
  rankAssistantCandidates,
} from "./assistant-search-ranking.ts";

test("normalize and compact text support company-name fuzzy matching", () => {
  assert.equal(normalizeAssistantText("  Blue   Harbor Trading "), "blue harbor trading");
  assert.equal(compactAssistantText("Blue Harbor Trading"), "blueharbortrading");
  assert.deepEqual(tokenizeAssistantText("Blue Harbor Trading"), ["blue", "harbor", "trading"]);
});

test("bigramDice treats compact misspellings as similar", () => {
  const exactish = bigramDice("blueharbor", "blueharbour");
  const unrelated = bigramDice("blueharbor", "consulting");
  assert.equal(exactish > unrelated, true);
  assert.equal(exactish > 0.45, true);
});

test("exact entity-name matches outrank incidental note text", () => {
  const query = "blueharbor";
  const exactOrg = scoreAssistantCandidate(query, {
    recordId: 17,
    recordType: "organization",
    matchedField: "Name",
    searchTexts: ["Blue Harbor", "Springfield"],
  });
  const noteOnly = scoreAssistantCandidate(query, {
    recordId: 44,
    recordType: "note",
    matchedField: "Note",
    searchTexts: ["Talked about Blue Harbor's office needs in passing"],
  });
  assert.equal(exactOrg > noteOnly, true);
});

test("numeric id lookups get the strongest score", () => {
  const exactId = scoreAssistantCandidate("4021", {
    recordId: 4021,
    recordType: "deal",
    matchedField: "Title",
    searchTexts: ["Springfield Office Expansion"],
  });
  const textOnly = scoreAssistantCandidate("4021", {
    recordId: 77,
    recordType: "deal",
    matchedField: "Comments",
    searchTexts: ["reference 4021 from old meeting notes"],
  });
  assert.equal(exactId > textOnly, true);
});

// Regression test for a real mismatch: searching a contact's name resolved
// to the deal that lists them as its contact instead of the person record
// itself, because deals got a flat scoring bonus regardless of which field
// actually matched — see assistant-search-ranking.ts.
test("a person's own name match outranks a deal that only matches via its linked contact", () => {
  const personScore = scoreAssistantCandidate("Dana Whitfield", {
    recordId: 6,
    recordType: "person",
    matchedField: "Name",
    searchTexts: ["Dana Whitfield", "dana@northwind.example", "", "Northwind Electronics"],
  });
  const dealScore = scoreAssistantCandidate("Dana Whitfield", {
    recordId: 5,
    recordType: "deal",
    matchedField: "Person",
    searchTexts: [
      "Northwind — Electronics rollout",
      "Northwind Electronics",
      "Dana Whitfield",
      "East region",
      "Standard",
      "",
    ],
  });
  assert.equal(personScore > dealScore, true);
});

test("tokenized company names outrank loose substrings", () => {
  const ranked = rankAssistantCandidates("Blue Harbor", [
    {
      recordType: "organization",
      recordId: 1,
      title: "Blue Harbor",
      matchedField: "Name",
      snippet: "Blue Harbor",
      relatedName: null,
      href: "/contacts?tab=organizations&focus=1",
      timestamp: new Date("2026-07-08T12:00:00Z"),
      ownerName: "Alex",
      score: 0,
      scoreBand: "low",
      searchTexts: ["Blue Harbor", "Springfield"],
    },
    {
      recordType: "note",
      recordId: 2,
      title: "Note on Other Org",
      matchedField: "Note",
      snippet: "Mentioned Blue Harbor once in a long note",
      relatedName: "Other Org",
      href: "/search?q=Blue%20Harbor",
      timestamp: new Date("2026-07-09T12:00:00Z"),
      ownerName: "Sam",
      score: 0,
      scoreBand: "low",
      searchTexts: ["Mentioned Blue Harbor once in a long note"],
    },
  ]);

  assert.equal(ranked[0]?.recordType, "organization");
  assert.equal(ranked[0]?.scoreBand, "high");
});

test("recentness breaks ties only after relevance", () => {
  const ranked = rankAssistantCandidates("regional expansion", [
    {
      recordType: "deal",
      recordId: 10,
      title: "Regional Expansion",
      matchedField: "Title",
      snippet: "Regional Expansion",
      relatedName: "ACME",
      href: "/deal/10",
      timestamp: new Date("2026-07-01T12:00:00Z"),
      ownerName: "Sam",
      score: 0,
      scoreBand: "low",
      searchTexts: ["Regional Expansion", "ACME"],
    },
    {
      recordType: "note",
      recordId: 11,
      title: "Note on ACME",
      matchedField: "Note",
      snippet: "mentioned the regional expansion workstream",
      relatedName: "ACME",
      href: "/search?q=regional%20expansion",
      timestamp: new Date("2026-07-10T12:00:00Z"),
      ownerName: "Sam",
      score: 0,
      scoreBand: "low",
      searchTexts: ["mentioned the regional expansion workstream"],
    },
  ]);

  assert.equal(ranked[0]?.recordType, "deal");
});

// --- Arabic retrieval — regression tests for the compact/tokenize
// unicode fix. Before the fix compact/tokenize stripped every Arabic character,
// so Arabic queries lost the entire fuzzy/compact/token match path. ---

test("Arabic text survives compact and tokenize (was stripped to empty)", () => {
  assert.notEqual(compactAssistantText("الوادي"), "");
  // "شركة" normalizes to "شركه" (ta-marbuta folded to ha — intended).
  assert.deepEqual(tokenizeAssistantText("شركة الوادي"), ["شركه", "الوادي"]);
});

test("Arabic normalization folds alef-maqsura / ta-marbuta / tashkeel variants", () => {
  // "الوادى" (final alef-maqsura) and "الوادي" (final ya) must match.
  assert.equal(compactAssistantText("الوادى"), compactAssistantText("الوادي"));
  // tatweel + a harakah must not change the compacted form.
  assert.equal(compactAssistantText("مكـتب"), compactAssistantText("مكتب"));
});

test("Arabic candidates now reach the strong compact/fuzzy score tiers", () => {
  // Exact compacted Arabic name should score at the top compact tier (>= 220),
  // not be capped at the substring tier (130) as before the fix.
  const score = scoreAssistantCandidate("الوادي", {
    recordId: 1,
    recordType: "organization",
    matchedField: "Name",
    searchTexts: ["الوادي"],
  });
  assert.ok(score >= 220, `expected a strong compact-tier score, got ${score}`);
});

test("Latin matching is unchanged by the unicode fix", () => {
  assert.equal(compactAssistantText("Blue Harbor Trading"), "blueharbortrading");
  assert.deepEqual(tokenizeAssistantText("Blue Harbor Trading"), ["blue", "harbor", "trading"]);
});
