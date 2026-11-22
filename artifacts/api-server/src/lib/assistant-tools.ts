import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import type { ToolDef } from "./ai-chat";
import { and, eq, ne, inArray, type SQL } from "drizzle-orm";
import { dealsTable } from "@workspace/db";
import {
  searchCrm,
  getRecordContext,
  clampLimit,
  SEARCH_LIMIT_DEFAULT,
  SEARCH_LIMIT_MAX,
} from "./assistant-search";
import type { AssistantRecordType } from "./assistant-search-ranking";
import {
  dealQuery,
  dealCountQuery,
  buildDealOrderBy,
  loadDealById,
  dealStats,
  dealDateRangeCondition,
  resolveStageIdsByName,
  listStageNames,
  movedIntoStageCondition,
  findOwnersByName,
  type DealStatFilters,
  type DealStatDimension,
} from "./queries";
import {
  toolDateFromSchema,
  toolDateToSchema,
  datesOrderError,
} from "./assistant-dates";
import { buildPipelineBoard } from "./pipeline-board";
import { logger } from "./logger";

// Defense in depth against a pathological skip-scan — offset values come from
// Claude's tool calls (not directly from the end user), but there's no reason
// to let the model page arbitrarily deep.
const MAX_OFFSET = 10000;

const RECORD_TYPES = [
  "deal",
  "person",
  "organization",
  "activity",
  "note",
] as const;

// Shared by every date-filtered tool: symbolic periods and calendar days are
// resolved in the workspace time zone, which the system prompt names.
const SYMBOLIC_DATE_HELP =
  "dateFrom/dateTo accept YYYY-MM-DD or a symbolic period (today, yesterday, this_week, last_week, this_month, last_month, this_quarter, last_quarter, this_year, last_year) resolved in the app time zone — prefer a symbolic period for relative-date questions.";

// Written in Anthropic's tool shape; ASSISTANT_TOOL_DEFS below is the
// provider-neutral form the assistant hands to either provider (ai-chat.ts).
const ASSISTANT_TOOLS: Anthropic.Tool[] = [
  {
    name: "search_crm",
    description:
      "Search CRM records from natural language. Use this first for company names, people, deals, notes, activities, and ambiguous lookup prompts.",
    input_schema: {
      type: "object",
      properties: {
        q: { type: "string", description: "The natural-language search query or entity name." },
        recordTypes: {
          type: "array",
          items: { type: "string", enum: [...RECORD_TYPES] },
          description: "Optional record types to narrow the lookup.",
        },
        limit: {
          type: "integer",
          description: `Maximum candidates to return (default ${SEARCH_LIMIT_DEFAULT}, max ${SEARCH_LIMIT_MAX}).`,
        },
      },
      required: ["q"],
    },
  },
  {
    name: "get_record_context",
    description:
      "Load the linked CRM context for a specific record after search_crm identifies it. Returns the main record summary plus related deals, notes, and activities.",
    input_schema: {
      type: "object",
      properties: {
        recordType: { type: "string", enum: [...RECORD_TYPES] },
        recordId: {
          type: "integer",
          description: "The resolved record id from search_crm's results — copy it exactly as given.",
        },
      },
      required: ["recordType", "recordId"],
    },
  },
  {
    name: "find_owner",
    description:
      "Resolve an INTERNAL team member (a deal owner / CRM user) by name — use this for questions about a team member's deals ('deals for Ahmad the sales lead', 'who owns the most deals'), NOT search_crm (which finds customer contacts). Returns matching users with their name, email, and open-deal count. Then pass a match's id as ownerId to deal_stats or list_deals. If one user matches, answer directly; if a few match, show each with their deal count; if many match, ask which one.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "The team member's name or partial name." },
      },
      required: ["name"],
    },
  },
  {
    name: "get_deal",
    description:
      "Look up a single deal by numeric id. Use this only when the user already gave a specific id or after a CRM search clearly identified the deal.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "integer", description: "The deal's numeric id." },
      },
      required: ["id"],
    },
  },
  {
    name: "list_deals",
    description:
      `List the specific deals matching structured filters — use this to NAME the deals behind a deal_stats count (e.g. 'which deals are in Initial Contact created since Thursday'), not just count them. Filter by stage NAME (no numeric id needed), created-or-won date range, owner, and status; results carry the true total so the list and a deal_stats count agree. Defaults to open deals only unless status is specified. ${SYMBOLIC_DATE_HELP} Examples: 'which open deals are in Proposal Sent right now', 'list deals created this week, highest value first', 'deals owned by user 12'. Do NOT use list_deals to COUNT or total — use deal_stats for a correct aggregate; and do NOT use it for deals that MOVED INTO a stage during a window (a transition question) — use deals_moved_to_stage.`,
    input_schema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["open", "won", "lost", "deleted"],
          description: "Filter by deal status. Omit to see open deals only.",
        },
        stage: {
          type: "string",
          description:
            "Filter by pipeline stage NAME (e.g. 'Initial Contact'), case-insensitive — preferred over stageId. If the name matches no stage, the tool replies with the valid stage names.",
        },
        stageId: { type: "integer", description: "Filter by pipeline stage id (prefer `stage` by name)." },
        dateField: {
          type: "string",
          enum: ["created", "won"],
          description: "Which date the range applies to (created = add date, won = won date). Defaults to created.",
        },
        dateFrom: { type: "string", description: "Inclusive start date YYYY-MM-DD." },
        dateTo: { type: "string", description: "Inclusive end date YYYY-MM-DD." },
        ownerId: { type: "integer", description: "Filter by the owning user's id (resolve a name with find_owner first)." },
        personId: { type: "integer", description: "Filter by associated contact id." },
        organizationId: {
          type: "integer",
          description: "Filter by associated organization id.",
        },
        sort: {
          type: "string",
          description:
            "Sort as 'field:asc' or 'field:desc'. Fields: title, value, addTime, wonTime, stage, organization, owner, status, utmKeyword.",
        },
        limit: {
          type: "integer",
          description: `Maximum rows to return (default ${SEARCH_LIMIT_DEFAULT}, max ${SEARCH_LIMIT_MAX}).`,
        },
        offset: { type: "integer", description: "Rows to skip, for pagination." },
      },
    },
  },
  {
    name: "deals_moved_to_stage",
    description:
      `List the deals that MOVED INTO (reached / entered / advanced to) a pipeline stage during a date window, read from stage-change history — use this for 'how many deals reached Initial Contact last week', 'which deals moved into Negotiation this month', or any stage-TRANSITION question. This is different from list_deals/deal_stats, which filter on a deal's CURRENT stage or its created date: a deal that entered the stage in the window and has since moved on still counts here (won/lost deals included; archived and deleted deals excluded). Filter by stage NAME (no numeric id) and a date range on the transition; optionally by owner or pipeline. Results carry the true total (distinct deals) so a list and a count agree. ${SYMBOLIC_DATE_HELP} Examples: 'how many deals reached Negotiation last week', 'which deals moved into Proposal Sent this month', 'deals that advanced to Won last quarter'. Do NOT use this for deals CURRENTLY in a stage or CREATED in a range — those are list_deals/deal_stats; this reads stage-change history, so a deal that entered the stage and has since moved on still counts.`,
    input_schema: {
      type: "object",
      properties: {
        stage: {
          type: "string",
          description:
            "The pipeline stage the deals moved INTO, by NAME (e.g. 'Initial Contact'), case-insensitive. If the name matches no stage, the tool replies with the valid stage names.",
        },
        dateFrom: { type: "string", description: "Inclusive start date YYYY-MM-DD for the move." },
        dateTo: { type: "string", description: "Inclusive end date YYYY-MM-DD for the move." },
        ownerId: { type: "integer", description: "Restrict to deals owned by this user id (resolve a name with find_owner first)." },
        pipelineId: { type: "integer", description: "Restrict to this pipeline id." },
        sort: {
          type: "string",
          description:
            "Sort as 'field:asc' or 'field:desc'. Fields: title, value, addTime, wonTime, stage, organization, owner, status, utmKeyword. Use 'value:desc' for highest-value first.",
        },
        limit: {
          type: "integer",
          description: `Maximum rows to return (default ${SEARCH_LIMIT_DEFAULT}, max ${SEARCH_LIMIT_MAX}).`,
        },
        offset: { type: "integer", description: "Rows to skip, for pagination." },
      },
      required: ["stage"],
    },
  },
  {
    name: "pipeline_summary",
    description:
      "Summarize a pipeline's board: deal count and total value per stage, plus overall totals.",
    input_schema: {
      type: "object",
      properties: {
        pipelineId: { type: "integer", description: "The pipeline's numeric id." },
        ownerId: {
          type: "integer",
          description: "Restrict to deals owned by this user id.",
        },
        q: { type: "string", description: "Free-text search on deal title." },
      },
    },
  },
  {
    name: "deal_stats",
    description:
      `Count deals and total their value, correctly, with optional filters and a breakdown. Use this for any 'how many deals…', 'total/pipeline value…', or 'deals by owner/stage/status/month' question — it excludes deleted and archived deals by default and sums value per currency. Filters: status (open|won|lost), ownerId, pipelineId, and a date range (dateFrom/dateTo as YYYY-MM-DD) applied to either the created date or the won date via dateField. groupBy one of none|owner|stage|status|month (month follows dateField). For 'deals added in the last 7 days' use dateField='created' with dateFrom/dateTo; for 'won value this quarter by owner' use status='won', dateField='won', and groupBy='owner'. ${SYMBOLIC_DATE_HELP} Examples: 'how many deals did we win last quarter', 'total open pipeline value by owner', 'deal count by stage this month'. Do NOT use deal_stats to NAME or list the specific deals — it returns only counts and totals; use list_deals to name them, or deals_moved_to_stage for deals that ENTERED a stage during a window.`,
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["open", "won", "lost"] },
        ownerId: { type: "integer", description: "Restrict to this owning user id." },
        pipelineId: { type: "integer" },
        dateField: {
          type: "string",
          enum: ["created", "won"],
          description: "Which date the range applies to (created = add date, won = won date).",
        },
        dateFrom: { type: "string", description: "Inclusive start date YYYY-MM-DD." },
        dateTo: { type: "string", description: "Inclusive end date YYYY-MM-DD." },
        groupBy: {
          type: "string",
          enum: ["none", "owner", "stage", "status", "month"],
          description: "Breakdown dimension; omit or 'none' for a single total.",
        },
      },
    },
  },
];

const SearchCrmInput = z.object({
  q: z.string().min(1),
  recordTypes: z.array(z.enum(RECORD_TYPES)).optional(),
  limit: z.number().optional(),
});

const GetRecordContextInput = z.object({
  recordType: z.enum(RECORD_TYPES),
  recordId: z.number().int(),
});

const GetDealInput = z.object({ id: z.number().int() });

const ListDealsInput = z.object({
  status: z.enum(["open", "won", "lost", "deleted"]).optional(),
  stageId: z.number().int().optional(),
  stage: z.string().optional(),
  ownerId: z.number().int().optional(),
  personId: z.number().int().optional(),
  organizationId: z.number().int().optional(),
  dateField: z.enum(["created", "won"]).optional(),
  dateFrom: toolDateFromSchema,
  dateTo: toolDateToSchema,
  sort: z.string().optional(),
  limit: z.number().optional(),
  offset: z.number().int().min(0).max(MAX_OFFSET).optional(),
}).superRefine((val, ctx) => {
  const msg = datesOrderError(val.dateFrom, val.dateTo);
  if (msg) ctx.addIssue({ code: z.ZodIssueCode.custom, message: msg });
});

const DealsMovedToStageInput = z.object({
  stage: z.string().min(1),
  dateFrom: toolDateFromSchema,
  dateTo: toolDateToSchema,
  ownerId: z.number().int().optional(),
  pipelineId: z.number().int().optional(),
  sort: z.string().optional(),
  limit: z.number().optional(),
  offset: z.number().int().min(0).max(MAX_OFFSET).optional(),
}).superRefine((val, ctx) => {
  const msg = datesOrderError(val.dateFrom, val.dateTo);
  if (msg) ctx.addIssue({ code: z.ZodIssueCode.custom, message: msg });
});

const FindOwnerInput = z.object({ name: z.string().min(1) });

const PipelineSummaryInput = z.object({
  pipelineId: z.number().int().optional(),
  ownerId: z.number().int().optional(),
  q: z.string().optional(),
});

const DealStatsInput = z.object({
  status: z.enum(["open", "won", "lost"]).optional(),
  ownerId: z.number().int().optional(),
  pipelineId: z.number().int().optional(),
  dateField: z.enum(["created", "won"]).optional(),
  dateFrom: toolDateFromSchema,
  dateTo: toolDateToSchema,
  groupBy: z.enum(["none", "owner", "stage", "status", "month"]).optional(),
}).superRefine((val, ctx) => {
  const msg = datesOrderError(val.dateFrom, val.dateTo);
  if (msg) ctx.addIssue({ code: z.ZodIssueCode.custom, message: msg });
});

type DealRow = NonNullable<Awaited<ReturnType<typeof loadDealById>>>;

function shapeDeal(deal: DealRow) {
  return {
    id: deal.id,
    title: deal.title,
    value: deal.value,
    currency: deal.currency,
    status: deal.status,
    stage: deal.stageName,
    owner: deal.ownerName,
    organization: deal.organizationName,
    person: deal.personName,
    expectedCloseDate: deal.expectedCloseDate,
    closeTime: deal.closeTime,
    lostReason: deal.lostReason,
    labels: deal.labels,
    comments: deal.comments,
    isRotting: deal.isRotting,
    lastActivityTime: deal.lastActivityTime,
    addTime: deal.addTime,
    updateTime: deal.updateTime,
  };
}

// Shared tail for the deal-listing tools (list_deals, deals_moved_to_stage):
// run the list and its count over the SAME where so the returned `total` always
// agrees with `items`, shaped uniformly for the model.
async function finishDealList(
  where: SQL | undefined,
  opts: { sort?: string; limit: number; offset: number },
) {
  const rows = await dealQuery()
    .where(where)
    .orderBy(...buildDealOrderBy(opts.sort))
    .limit(opts.limit)
    .offset(opts.offset);
  const [{ count }] = await dealCountQuery().where(where);
  return {
    items: rows.map(shapeDeal),
    total: count,
    limit: opts.limit,
    offset: opts.offset,
  };
}

// Resolve a stage NAME to its stage ids, or a model-facing error listing the
// valid stage names — shared by the stage-filtered deal tools so the "no such
// stage" contract stays identical across them.
async function resolveStageOrError(
  name: string,
): Promise<{ stageIds: number[] } | { error: string }> {
  const stageIds = await resolveStageIdsByName(name);
  if (stageIds.length === 0) {
    const names = await listStageNames();
    return {
      error: `No pipeline stage named "${name}". Valid stages: ${names.join(", ")}.`,
    };
  }
  return { stageIds };
}

export const ASSISTANT_TOOL_DEFS: ToolDef[] = ASSISTANT_TOOLS.map((tool) => ({
  name: tool.name,
  description: tool.description ?? "",
  parameters: tool.input_schema as Record<string, unknown>,
}));

export interface ToolResult {
  ok: boolean;
  data?: unknown;
  message?: string;
}

export async function executeTool(
  name: string,
  input: unknown,
): Promise<ToolResult> {
  try {
    switch (name) {
      case "search_crm": {
        const p = SearchCrmInput.parse(input);
        const result = await searchCrm(p.q, {
          recordTypes: p.recordTypes as AssistantRecordType[] | undefined,
          limit: clampLimit(p.limit),
        });
        return { ok: true, data: result };
      }
      case "get_record_context": {
        const p = GetRecordContextInput.parse(input);
        const result = await getRecordContext(p.recordType, p.recordId);
        if (!result) {
          return {
            ok: false,
            message: `No ${p.recordType} found with id ${p.recordId}.`,
          };
        }
        return { ok: true, data: result };
      }
      case "find_owner": {
        const p = FindOwnerInput.parse(input);
        const owners = await findOwnersByName(p.name);
        return { ok: true, data: { owners, total: owners.length } };
      }
      case "get_deal": {
        const { id } = GetDealInput.parse(input);
        const deal = await loadDealById(id);
        if (!deal) return { ok: false, message: `No deal found with id ${id}.` };
        return { ok: true, data: shapeDeal(deal) };
      }
      case "list_deals": {
        const p = ListDealsInput.parse(input);
        const conditions = [eq(dealsTable.archived, false), eq(dealsTable.status, p.status ?? "open")];
        if (p.stage != null && p.stage.trim() !== "") {
          const resolved = await resolveStageOrError(p.stage);
          if ("error" in resolved) return { ok: false, message: resolved.error };
          conditions.push(inArray(dealsTable.stageId, resolved.stageIds));
        }
        if (p.stageId != null) conditions.push(eq(dealsTable.stageId, p.stageId));
        const dateCond = dealDateRangeCondition(p.dateField, p.dateFrom, p.dateTo);
        if (dateCond) conditions.push(dateCond);
        if (p.ownerId != null) conditions.push(eq(dealsTable.ownerId, p.ownerId));
        if (p.personId != null) conditions.push(eq(dealsTable.personId, p.personId));
        if (p.organizationId != null) {
          conditions.push(eq(dealsTable.organizationId, p.organizationId));
        }
        const data = await finishDealList(and(...conditions), {
          sort: p.sort,
          limit: clampLimit(p.limit),
          offset: p.offset ?? 0,
        });
        return { ok: true, data };
      }
      case "deals_moved_to_stage": {
        const p = DealsMovedToStageInput.parse(input);
        const resolved = await resolveStageOrError(p.stage);
        if ("error" in resolved) return { ok: false, message: resolved.error };
        // Exclude soft-deleted and archived deals so the total agrees with
        // deal_stats/list_deals (a deal that reached the stage then was deleted
        // is not a live "moved into" result). Won/lost are kept — they still
        // legitimately transitioned into the stage during the window.
        const conditions = [
          eq(dealsTable.archived, false),
          ne(dealsTable.status, "deleted"),
          movedIntoStageCondition({
            stageIds: resolved.stageIds,
            dateFrom: p.dateFrom,
            dateTo: p.dateTo,
          }),
        ];
        if (p.ownerId != null) conditions.push(eq(dealsTable.ownerId, p.ownerId));
        if (p.pipelineId != null) {
          conditions.push(eq(dealsTable.pipelineId, p.pipelineId));
        }
        const data = await finishDealList(and(...conditions), {
          sort: p.sort,
          limit: clampLimit(p.limit),
          offset: p.offset ?? 0,
        });
        return { ok: true, data };
      }
      case "pipeline_summary": {
        const p = PipelineSummaryInput.parse(input);
        const board = await buildPipelineBoard(p);
        if (!board) {
          return {
            ok: false,
            message:
              p.pipelineId == null
                ? "No default pipeline is configured."
                : `No pipeline found with id ${p.pipelineId}.`,
          };
        }
        return {
          ok: true,
          data: {
            pipelineId: board.pipelineId,
            pipelineName: board.pipelineName,
            totalCount: board.totalCount,
            totalValue: board.totalValue,
            columns: board.columns.map((column) => ({
              stageId: column.stageId,
              stageName: column.stageName,
              orderIndex: column.orderIndex,
              count: column.count,
              sum: column.sum,
            })),
          },
        };
      }
      case "deal_stats": {
        const { groupBy, ...filters } = DealStatsInput.parse(input);
        const groups = await dealStats(
          filters as DealStatFilters,
          (groupBy ?? "none") as DealStatDimension,
        );
        return { ok: true, data: { groups } };
      }
      default:
        return { ok: false, message: `Unknown tool: ${name}` };
    }
  } catch (err) {
    if (err instanceof z.ZodError) {
      return {
        ok: false,
        message: `Invalid input: ${err.issues.map((i) => i.message).join("; ")}`,
      };
    }
    logger.error({ err, tool: name }, "Assistant tool execution failed");
    return { ok: false, message: "This lookup is temporarily unavailable right now." };
  }
}
