import { runTurn, type AiConfig, type ChatMessage, type ToolResultPart } from "./ai-chat";
import { logger } from "./logger";
import { ASSISTANT_TOOL_DEFS, executeTool } from "./assistant-tools";
import { analyzeAssistantQuery, resolveAssistantCandidates } from "./assistant-planner";
import type { AssistantSearchCandidate } from "./assistant-search-ranking";
import { APP_TIMEZONE, appTodayIso } from "./assistant-dates";

// ---------------------------------------------------------------------------
// Ask AI assistant: a tool-use loop around the workspace's AI provider
// (OpenAI or Anthropic, see ai-chat.ts), with a deterministic "bootstrap"
// pre-fetch step in front of it. "Claude" below means whichever model the
// workspace connected; the loop is the same for both.
//
// The bootstrap's ONLY job is speed: for common intents (pipeline summary,
// "my deals", a specific deal id, a name/company lookup) it figures
// out which tool(s) to call up front and runs them before the first model
// call, so the common case is one well-informed Claude call instead of
// several blind tool-call round trips.
//
// It is NOT allowed to answer the user directly. Every reply — including
// "I couldn't find that" and "did you mean X or Y" — is written by Claude.
// An earlier version of this file had the bootstrap short-circuit straight
// to a hand-templated answer for several intents, skipping the model
// entirely. That's exactly backwards: a misclassified intent or a
// wrong-but-plausible search match became a confident, unhedged answer with
// no LLM oversight. Routing everything through Claude means a bad bootstrap
// guess is merely wasted pre-fetch (Claude ignores irrelevant context and
// uses its own tools instead) rather than a wrong answer reaching the user.
//
// Read-only: Ask AI cannot make any changes in this CRM. Write
// capability is tracked separately and deliberately not part of this build.
//
// There is deliberately no raw-SQL tool. Tenant isolation is Postgres
// row-level security keyed on a per-connection setting, and model-authored SQL
// could change that setting, so every tool here is a fixed query over `db`.
// ---------------------------------------------------------------------------

// Headroom for a tool-use turn (preamble text + tool_use blocks) plus a
// multi-record synthesis answer. Raised from 2048: an analytical
// answer can verbalize a multi-row GROUP BY result (e.g. value by owner/stage)
// plus the reasoning around it, which 2048 could clip via stop_reason
// "max_tokens"; 4096 keeps margin while still bounding a runaway response.
const MAX_TOKENS = 4096;
// OpenAI's reasoning models count their thinking against the same budget
// before they write a word, so they get more room for the same visible answer.
const MAX_TOKENS_OPENAI = 16384;
// Raised from 5: lookups legitimately chain — resolve a name with
// search_crm or find_owner, load its context, run a follow-up aggregate, then
// answer.
const MAX_TOOL_ITERATIONS = 8;
// The per-call ceiling is AI_REQUEST_TIMEOUT_MS (lib/ai-chat.ts). It matters most here: with MAX_TOOL_ITERATIONS = 8
// the SDK's 10-minute default would be a theoretical ~80-minute worst case for
// one request. Combined with the AbortController wired in from the route handler
// (cancels on client disconnect), this gives a real, enforced ceiling of a few
// minutes on the whole tool loop.
const TRUNCATED_RESPONSE_NOTICE =
  "\n\n[The assistant response was truncated. Please ask a narrower follow-up if you need more detail.]";
// A reply must never be empty: an empty assistant turn stored in history becomes
// an empty text block on the next request, which the Anthropic API rejects with a
// 400 — bricking the chat until "New chat".
const EMPTY_REPLY_FALLBACK =
  "I couldn't put together an answer for that. Could you rephrase it or add a little more detail?";
// SYSTEM_PROMPT and ASSISTANT_TOOLS are identical on every request; providers
// that cache a prompt prefix (Anthropic, with explicit breakpoints set in
// ai-chat.ts; OpenAI, automatically) reuse it across a multi-iteration tool
// loop and later turns of the same chat.

const SYSTEM_PROMPT = `You are "Ask AI," an internal assistant built into this CRM — the team's system for deals, contacts, organizations, activities, notes, and the sales pipeline.

Scope: you can only answer questions about deals, contacts (people), organizations, notes, activities, team members' deals, and pipeline status, using the tools provided. You have no other capability — no general knowledge, no coding help, nothing unrelated to this CRM's data.

If a question is not about this CRM's data, decline briefly and say what you can help with instead — do not answer it from general knowledge even if you happen to know the answer.

Use a two-step read flow for named-record lookups: identify the intended CRM record(s) with search_crm, then load the linked facts with get_record_context (and secondary tools only when needed). Then answer from those results.

For analytical questions — counts, totals, breakdowns, trends — use deal_stats, which already computes the answer correctly (right columns, de-duplication, currency handling), so you never have to estimate. It gives deal counts and value totals, filterable by status/owner/pipeline and a created-or-won date range, broken down by owner/stage/status/month. Use it for "how many deals were added this week", "total won value by owner", "open pipeline value by stage". Never estimate a count from a truncated list — call deal_stats.

Money: report each amount in the currency the tool result gives it in (every deal row and every deal_stats group carries its own currency). Never convert between currencies, assume a currency, or add amounts in different currencies together.

To NAME the specific deals behind a count (e.g. "which deals are in Initial Contact created since Thursday", "who are they"), call list_deals with the stage by NAME plus dateFrom/dateTo — do not say you can't list them. list_deals filters by stage name, created/won date range, owner, and status, and returns each deal's name, value, owner, and stage with the true total, so its list agrees with a deal_stats count over the same filter.

For a stage-TRANSITION question — "how many deals MOVED INTO / reached / entered / advanced to <stage> during <window>", "which deals hit Negotiation this month" — use deals_moved_to_stage (stage by NAME plus dateFrom/dateTo), NOT list_deals or deal_stats. Those two filter on a deal's CURRENT stage or created date, so they miss deals that entered the stage in the window and have since moved on; deals_moved_to_stage reads the stage-change history and counts every entry into the stage. Reserve it for "moved into / reached" wording — for "deals currently in <stage>" or "created in <stage> since <date>" stay with list_deals/deal_stats.

For a question about an internal team member's deals ("how many deals for Ahmad the sales lead", "who owns the most deals"), first call find_owner with the name to resolve them to a user id, then pass that id as ownerId to deal_stats or list_deals — do not use search_crm, which finds customer contacts, not team members.

If the user types a bare name or keyword instead of a full question (e.g. "Acme", "deal 4021"), treat it as a lookup: use search_crm (or get_deal for an explicit deal id) first and report what you find, rather than asking them to rephrase it as a question.

Name search is fuzzy — it tolerates misspellings and approximate names, not just exact substrings. Don't assume a name doesn't exist just because it isn't a perfect match: if a search comes back empty, try a shorter or simplified version of the name before telling the user nothing was found. If a result is a plausible-but-not-exact match to what they typed, say what you actually found and confirm it's the right one rather than presenting it as certain.

When a question is about a company, contact, or opportunity, synthesize across linked records when helpful: deals, recent notes, recent activities, and ownership. Do not stop at the first narrow tool if the question clearly asks for broader context.

Never invent data — every fact must come from a tool result. If a request is ambiguous (which deal, which pipeline, multiple matches), ask a short clarifying question instead of guessing.

Keep answers concise and specific (names, numbers, ids) rather than generic summaries.

You are read-only: you cannot create, edit, or delete anything in this CRM. If asked to make a change, say plainly that it isn't available yet rather than attempting a workaround through the tools you do have.`;

export interface AssistantMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AssistantContext {
  userId: number;
  userName?: string | null;
}

export interface AssistantToolTrace {
  toolName: string;
  input: unknown;
  ok: boolean;
  data?: unknown;
  error?: string;
}

export interface AssistantReply {
  reply: string;
  traces: AssistantToolTrace[];
}

/**
 * Progress callbacks fired while runAssistant works, so a caller (the SSE
 * route handler) can stream events to the client as they happen. All are
 * optional — a caller that just wants the final { reply, traces } (e.g. a
 * script or test) can omit them and get the exact same return value as
 * before.
 */
export interface AssistantStreamHandlers {
  onTextDelta?: (text: string) => void;
  onToolCall?: (toolName: string, input: unknown) => void;
  onToolResult?: (trace: AssistantToolTrace) => void;
}

export async function runAssistant(
  config: AiConfig,
  message: string,
  history: AssistantMessage[] = [],
  context?: AssistantContext,
  handlers?: AssistantStreamHandlers,
  signal?: AbortSignal,
): Promise<AssistantReply> {
  const traces: AssistantToolTrace[] = [];
  const modelContext = await runDeterministicBootstrap(message, traces, context, handlers);
  const dynamicSystem = buildDynamicSystemPrompt(context, modelContext);

  // Mark the end of the incoming history and the end of the new live message
  // as cache breakpoints (on top of the one on SYSTEM_PROMPT). History is
  // byte-identical to what a prior turn already sent, so it lets this turn
  // reuse that turn's cache; the live-message breakpoint lets iterations 2+
  // of this turn's own tool loop reuse iteration 1's cache instead of
  // reprocessing the same prefix on every round trip.
  const messages: ChatMessage[] = history.map((m, idx) =>
    m.role === "user"
      ? { role: "user", text: m.content, cacheMark: idx === history.length - 1 }
      : { role: "assistant", text: m.content, cacheMark: idx === history.length - 1 },
  );
  messages.push({ role: "user", text: message, cacheMark: true });

  // Every iteration's pre-tool-call text is streamed live to the client via
  // onTextDelta below, so it must also be accumulated here — otherwise a
  // later iteration's terminal reply would silently overwrite text the user
  // already saw arrive.
  const preambleParts: string[] = [];

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    const turn = await runTurn(config, {
      stableSystem: SYSTEM_PROMPT,
      dynamicSystem,
      tools: ASSISTANT_TOOL_DEFS,
      messages,
      maxTokens: config.provider === "openai" ? MAX_TOKENS_OPENAI : MAX_TOKENS,
      onTextDelta: handlers?.onTextDelta,
      signal,
    });

    if (turn.stop === "refusal") {
      logger.warn({ message, provider: config.provider }, "Assistant request was refused by the model");
      return {
        reply: "I couldn't help with that request. Please rephrase it as a read-only CRM question.",
        traces,
      };
    }

    const toolUseBlocks = turn.toolCalls;
    const isTruncated = turn.stop === "truncated";

    // A truncated turn can still contain a fully-formed tool_use block —
    // Claude writes preamble text, then a complete tool call, then runs out
    // of budget before continuing. Only treat truncation as terminal when
    // there's no pending tool call to run; otherwise fall through and
    // execute it like a normal tool_use turn.
    if (isTruncated && toolUseBlocks.length === 0) {
      if (turn.rawStop !== "max_tokens" && turn.rawStop !== "length") {
        logger.warn({ message, stopReason: turn.rawStop }, "Assistant response ended early");
      }
      const reply = [...preambleParts, turn.text].filter(Boolean).join("\n\n");
      return { reply: reply + TRUNCATED_RESPONSE_NOTICE, traces };
    }

    if (!isTruncated && turn.stop !== "tool_use") {
      const reply = [...preambleParts, turn.text].filter(Boolean).join("\n\n");
      return { reply: reply || EMPTY_REPLY_FALLBACK, traces };
    }

    messages.push({ role: "assistant", text: turn.text, toolCalls: turn.toolCalls });

    if (turn.text) preambleParts.push(turn.text);

    const results = await Promise.all(
      toolUseBlocks.map((call) => runOneTool(call, traces, handlers)),
    );
    messages.push({ role: "tool", results });
  }

  logger.warn({ message }, "Assistant hit the tool-iteration cap");
  return {
    reply: [...preambleParts, "I wasn't able to finish looking that up — could you narrow down the question?"]
      .filter(Boolean)
      .join("\n\n"),
    traces,
  };
}

/**
 * The per-request part of the system prompt, kept apart from SYSTEM_PROMPT —
 * it differs on every message (user id, live search results), so folding it
 * into the same block would invalidate the cached prefix on every request.
 */
function buildDynamicSystemPrompt(
  context: AssistantContext | undefined,
  modelContext: string | undefined,
): string {
  // Always tell the model "now" so it can turn relative ranges ("last 7 days",
  // "this quarter") into absolute dates for the date filters. Lives in the
  // uncached dynamic block because it changes daily.
  let dynamic = `Today's date in the ${APP_TIMEZONE} time zone (the app time zone) is ${appTodayIso()}. When the user asks for a relative range ("last 7 days", "this month", "this quarter"), pass a symbolic period (e.g. this_month) or compute the absolute start and end calendar dates from this date, as the dateFrom/dateTo (YYYY-MM-DD) filters.`;
  if (context) {
    const userName = context.userName?.trim() || "the current user";
    dynamic += `

The authenticated CRM user for this chat is ${userName} (user id ${context.userId}).
When the user says "me", "my deals", or "owned by me", use ownerId=${context.userId}.
For pipeline_summary, you may omit pipelineId when the user asks for the main/default pipeline.`;
  }
  if (modelContext) {
    dynamic += `

Deterministic retrieval bootstrap for this request — the data below was already fetched from the CRM before you started, using the same tools you have access to:
${modelContext}

If this JSON includes a "note" field, it is flagging low confidence, ambiguity, or a partial failure — follow the note (e.g. ask the user a short clarifying question) rather than treating the data as certain. Otherwise, this bootstrap data is authoritative for the record(s) shown: it was just fetched and is current, so do not re-call search_crm or get_record_context on the same record to "confirm" it — that spends a tool call without changing the answer. Use it directly, and only call additional tools for information that's genuinely missing here (a different record, or something the user asks for next).`;
  }

  return dynamic.trim();
}

async function runOneTool(
  call: { id: string; name: string; input: unknown },
  traces: AssistantToolTrace[],
  handlers?: AssistantStreamHandlers,
): Promise<ToolResultPart> {
  const result = await executeToolWithTrace(call.name, call.input, traces, handlers);
  if (result.ok) {
    return { id: call.id, content: JSON.stringify(result.data ?? null) };
  }
  return { id: call.id, content: result.message ?? "Tool call failed.", isError: true };
}

async function executeToolWithTrace(
  toolName: string,
  input: unknown,
  traces: AssistantToolTrace[],
  handlers?: AssistantStreamHandlers,
) {
  handlers?.onToolCall?.(toolName, input);
  const result = await executeTool(toolName, input);
  const trace: AssistantToolTrace = result.ok
    ? { toolName, input, ok: true, data: summarizeTraceData(toolName, result.data) }
    : { toolName, input, ok: false, error: result.message ?? "Tool call failed." };
  traces.push(trace);
  handlers?.onToolResult?.(trace);
  return result;
}

/**
 * Pre-fetches the tool(s) the query most likely needs, based on the (fixed,
 * regression-tested) intent classifier, and serializes whatever it finds as
 * a JSON hint for the model. Returns undefined when nothing deterministic
 * applies or the pre-fetch didn't turn up anything usable — in both cases
 * Claude runs the normal tool-use loop from scratch, unassisted.
 */
async function runDeterministicBootstrap(
  message: string,
  traces: AssistantToolTrace[],
  context?: AssistantContext,
  handlers?: AssistantStreamHandlers,
): Promise<string | undefined> {
  const plan = analyzeAssistantQuery(message);

  if (plan.intent === "pipeline_summary") {
    const pipeline = await executeToolWithTrace(
      "pipeline_summary",
      plan.mentionsCurrentUser && context ? { ownerId: context.userId } : {},
      traces,
      handlers,
    );
    if (!pipeline.ok) return undefined;
    return JSON.stringify({ intent: plan.intent, pipelineSummary: pipeline.data });
  }

  if (plan.intent === "my_deals_list" && context) {
    const deals = await executeToolWithTrace(
      "list_deals",
      { ownerId: context.userId, status: plan.myDealsStatus },
      traces,
      handlers,
    );
    if (!deals.ok) return undefined;
    return JSON.stringify({ intent: plan.intent, myDeals: deals.data });
  }

  if (plan.directDealId) {
    const deal = await executeToolWithTrace(
      "get_deal",
      { id: plan.directDealId },
      traces,
      handlers,
    );
    if (deal.ok) {
      return JSON.stringify({
        intent: plan.intent,
        note: "The user's message contained what looks like a specific deal id.",
        deal: deal.data,
      });
    }
    // The id guess didn't resolve to a real deal — fall through to a normal
    // name/keyword search below rather than giving up.
  }

  const primary = await executeToolWithTrace(
    "search_crm",
    { q: plan.searchQuery, recordTypes: plan.recordTypes, limit: 6 },
    traces,
    handlers,
  );
  let searchItems = primary.ok
    ? (((primary.data as Record<string, unknown>).items ?? []) as AssistantSearchCandidate[])
    : [];

  if (!searchItems.length && plan.fallbackSearchQuery) {
    const fallback = await executeToolWithTrace(
      "search_crm",
      { q: plan.fallbackSearchQuery, recordTypes: plan.recordTypes, limit: 6 },
      traces,
      handlers,
    );
    if (fallback.ok) {
      searchItems = ((fallback.data as Record<string, unknown>).items ?? []) as AssistantSearchCandidate[];
    }
  }

  if (!searchItems.length) return undefined;

  const resolved = resolveAssistantCandidates(searchItems);

  if (resolved.kind === "none") return undefined;

  if (resolved.kind === "ambiguous") {
    return JSON.stringify({
      intent: plan.intent,
      note: "Multiple plausible CRM matches were found — ask the user which one they meant before answering. Do not pick one for them.",
      candidates: resolved.candidates.map((c) => ({
        recordType: c.recordType,
        recordId: c.recordId,
        title: c.title,
        relatedName: c.relatedName,
        scoreBand: c.scoreBand,
      })),
    });
  }

  const contextResult = await executeToolWithTrace(
    "get_record_context",
    { recordType: resolved.candidate.recordType, recordId: resolved.candidate.recordId },
    traces,
    handlers,
  );
  if (!contextResult.ok) {
    return JSON.stringify({
      intent: plan.intent,
      note: "A likely CRM match was found, but its full context could not be loaded.",
      selectedRecord: {
        recordType: resolved.candidate.recordType,
        recordId: resolved.candidate.recordId,
        title: resolved.candidate.title,
      },
    });
  }

  return JSON.stringify({
    intent: plan.intent,
    matchConfidence: resolved.candidate.scoreBand,
    selectedRecord: {
      recordType: resolved.candidate.recordType,
      recordId: resolved.candidate.recordId,
      title: resolved.candidate.title,
    },
    recordContext: contextResult.data,
  });
}

function summarizeTraceData(toolName: string, data: unknown): unknown {
  if (!data || typeof data !== "object") return data;

  if (toolName === "search_crm") {
    const payload = data as { items?: unknown[]; total?: number; truncated?: boolean };
    return {
      items: payload.items?.slice(0, 5) ?? [],
      total: payload.total ?? 0,
      truncated: payload.truncated ?? false,
    };
  }

  return data;
}
