import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analyzeAssistantQuery,
  buildAssistantClarification,
  inferAssistantIntent,
  resolveAssistantCandidates,
} from "./assistant-planner.ts";
import type { AssistantSearchCandidate } from "./assistant-search-ranking.ts";

test("analyzeAssistantQuery extracts company names from plain-language snapshot prompts", () => {
  const plan = analyzeAssistantQuery(
    "What should I know about Blue Harbor?",
  );
  assert.equal(plan.intent, "company_snapshot");
  assert.equal(plan.searchQuery, "Blue Harbor");
  assert.deepEqual(plan.recordTypes, [
    "organization",
    "deal",
    "person",
    "note",
    "activity",
  ]);
});

test("analyzeAssistantQuery extracts deal lookup text from owner questions", () => {
  const plan = analyzeAssistantQuery("Who is handling the Springfield office expansion deal?");
  assert.equal(plan.intent, "deal_owner");
  assert.equal(plan.searchQuery, "the Springfield office expansion");
});

test("resolveAssistantCandidates marks close top results as ambiguous", () => {
  const candidates: AssistantSearchCandidate[] = [
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
      score: 250,
      scoreBand: "high",
    },
    {
      recordType: "deal",
      recordId: 2,
      title: "Blue Harbor Renewal",
      matchedField: "Title",
      snippet: "Blue Harbor Renewal",
      relatedName: "Blue Harbor",
      href: "/deal/2",
      timestamp: new Date("2026-07-08T12:00:00Z"),
      ownerName: "Sam",
      score: 228,
      scoreBand: "high",
    },
  ];

  const resolution = resolveAssistantCandidates(candidates);
  assert.equal(resolution.kind, "ambiguous");
});

function candidate(
  overrides: Partial<AssistantSearchCandidate> & Pick<AssistantSearchCandidate, "score" | "scoreBand">,
): AssistantSearchCandidate {
  return {
    recordType: "organization",
    recordId: 1,
    title: "Some Record",
    matchedField: "Name",
    snippet: "Some Record",
    relatedName: null,
    href: "/contacts?tab=organizations&focus=1",
    timestamp: new Date("2026-07-08T12:00:00Z"),
    ownerName: null,
    ...overrides,
  };
}

test("resolveAssistantCandidates reports a low-band top as none, not a confident match", () => {
  // A single weak/near-zero-score hit must not be handed to the model as an
  // authoritative match. It also must not become "ambiguous" when a second
  // equally-weak hit is present.
  assert.equal(resolveAssistantCandidates([candidate({ score: 10, scoreBand: "low" })]).kind, "none");
  assert.equal(
    resolveAssistantCandidates([
      candidate({ recordId: 1, score: 10, scoreBand: "low" }),
      candidate({ recordId: 2, score: 8, scoreBand: "low" }),
    ]).kind,
    "none",
  );
});

test("resolveAssistantCandidates uses a single 45-point gap boundary for medium tops", () => {
  // A medium top clearing the runner-up by >= 45 resolves; within 45 it is
  // ambiguous. (The old medium-only `>= 80` branch never changed an outcome.)
  const clear = resolveAssistantCandidates([
    candidate({ recordId: 1, score: 180, scoreBand: "medium" }),
    candidate({ recordId: 2, score: 130, scoreBand: "medium" }),
  ]);
  assert.equal(clear.kind, "resolved");

  const close = resolveAssistantCandidates([
    candidate({ recordId: 1, score: 180, scoreBand: "medium" }),
    candidate({ recordId: 2, score: 160, scoreBand: "medium" }),
  ]);
  assert.equal(close.kind, "ambiguous");
});

// Regression tests for three verified bugs found in an earlier version of
// inferAssistantIntent/analyzeAssistantQuery: (1) an alternation like
// `\bhandling|owner|owns|owned\b` only binds `\b` to the first/last term, so
// "owner"/"owns"/"owned" matched as bare substrings anywhere; (2) "stage"
// being treated as a pipeline-wide signal stole obviously deal-specific
// questions; (3) any 2+-digit number in a message (a price, a quantity, a
// year) was extracted as a "direct deal id".
test("intent inference does not false-positive on 'owned' inside an unrelated word", () => {
  assert.notEqual(inferAssistantIntent("who disowned this account"), "deal_owner");
});

test("intent inference does not false-positive on 'stage' inside deal-specific questions", () => {
  assert.equal(
    inferAssistantIntent("who is handling the deal in the negotiation stage"),
    "deal_owner",
  );
  assert.equal(inferAssistantIntent("what stage is the Blue Harbor deal in"), "deal_status");
});

test("intent inference still recognizes a genuine pipeline-wide question", () => {
  assert.equal(inferAssistantIntent("summarize the main pipeline"), "pipeline_summary");
});

// Regression test: "tell me about my deals" used to fall into
// company_snapshot (matching the "tell me about" prefix) and bootstrap a
// search_crm for the literal text "my deals", which matches nothing and
// wastes a tool call — see runDeterministicBootstrap in assistant.ts.
test("a generic 'my deals' request is recognized as a list request, not a company lookup", () => {
  assert.equal(inferAssistantIntent("tell me about my deals"), "my_deals_list");
  assert.equal(inferAssistantIntent("show me my open deals"), "my_deals_list");
  assert.equal(analyzeAssistantQuery("my won deals").myDealsStatus, "won");
  assert.equal(analyzeAssistantQuery("tell me about my deals").myDealsStatus, "open");
});

test("a specific single-deal question is not mistaken for a 'list my deals' request", () => {
  assert.notEqual(inferAssistantIntent("tell me about my deal with Northwind"), "my_deals_list");
});

test("directDealId ignores incidental numbers in ordinary questions", () => {
  assert.equal(
    analyzeAssistantQuery("how much for 30 units in the Springfield office").directDealId,
    undefined,
  );
  assert.equal(
    analyzeAssistantQuery("what's the status of the deal worth 45000").directDealId,
    undefined,
  );
  assert.equal(analyzeAssistantQuery("summarize the pipeline for 2026").directDealId, undefined);
});

test("directDealId still recognizes an explicit deal id reference", () => {
  assert.equal(analyzeAssistantQuery("4021").directDealId, 4021);
  assert.equal(analyzeAssistantQuery("what's up with deal 4021?").directDealId, 4021);
  assert.equal(analyzeAssistantQuery("pull up deal id 4021 please").directDealId, 4021);
});

test("buildAssistantClarification gives user-friendly options", () => {
  const message = buildAssistantClarification("Blue Harbor", [
    {
      recordType: "organization",
      recordId: 1,
      title: "Blue Harbor",
      matchedField: "Name",
      snippet: "Blue Harbor",
      relatedName: null,
      href: "/contacts?tab=organizations&focus=1",
      timestamp: null,
      ownerName: null,
      score: 250,
      scoreBand: "high",
    },
  ]);
  assert.match(message, /Which one did you mean/);
  assert.match(message, /1\. Blue Harbor/);
});

// --- Plural-keyword intents: singular \b-anchored keywords didn't match the
// plural forms users actually type, silently dropping the intent. ---
test("plural keywords still classify by intent", () => {
  assert.equal(inferAssistantIntent("list the pipelines"), "pipeline_summary");
  assert.equal(inferAssistantIntent("what stages is the Acme deal through"), "deal_status");
  // singular forms still work (no regression)
  assert.equal(inferAssistantIntent("summarize the board"), "pipeline_summary");
  assert.equal(inferAssistantIntent("what stage is Acme at"), "deal_status");
});

// --- "show me" is a display verb, not an ownership signal — it wrongly scoped
// the whole-pipeline answer to the current user's own deals. ---
test("'show me' is display, not ownership; 'my' still is", () => {
  assert.equal(analyzeAssistantQuery("show me the pipeline").mentionsCurrentUser, false);
  assert.equal(analyzeAssistantQuery("summarize my pipeline").mentionsCurrentUser, true);
  assert.equal(analyzeAssistantQuery("which deals are assigned to me").mentionsCurrentUser, true);
});
