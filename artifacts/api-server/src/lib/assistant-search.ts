import {
  and,
  desc,
  eq,
  ilike,
  inArray,
  ne,
  or,
  sql,
  type AnyColumn,
  type SQL,
} from "drizzle-orm";
import {
  db,
  dealsTable,
  personsTable,
  organizationsTable,
  activitiesTable,
  notesTable,
  usersTable,
} from "@workspace/db";
import {
  activityQuery,
  dealQuery,
  escapeLike,
  loadDealById,
  loadOrganizationById,
  loadPersonById,
  noteQuery,
  phoneMatch,
  phoneNsn,
  PHONE_MIN_NSN,
} from "./queries";
import {
  normalizeAssistantText,
  compactAssistantText,
  rankAssistantCandidates,
  type AssistantRecordType,
  type AssistantSearchCandidate,
  type CandidateForScoring,
} from "./assistant-search-ranking";

export const SEARCH_LIMIT_DEFAULT = 8;
export const SEARCH_LIMIT_MAX = 20;
const RELATED_DEALS_LIMIT = 5;
const RECENT_NOTES_LIMIT = 6;
const RECENT_ACTIVITIES_LIMIT = 6;
const FUZZY_THRESHOLD = 0.45;

type RecordFilter = AssistantRecordType;

export interface AssistantSearchOptions {
  recordTypes?: RecordFilter[];
  limit?: number;
}

export interface AssistantRecordContext {
  recordType: AssistantRecordType;
  recordId: number;
  title: string;
  summary: Record<string, unknown>;
  relatedDeals?: ReturnType<typeof shapeDealSummary>[];
  recentNotes?: ReturnType<typeof shapeNoteSummary>[];
  recentActivities?: ReturnType<typeof shapeActivitySummary>[];
}

export function clampLimit(limit: number | undefined, fallback = SEARCH_LIMIT_DEFAULT): number {
  if (!limit || limit < 1) return fallback;
  return Math.min(Math.floor(limit), SEARCH_LIMIT_MAX);
}

function compactSql(col: AnyColumn): SQL<string> {
  return sql<string>`regexp_replace(lower(coalesce(${col}, '')), '[^a-z0-9]+', '', 'g')`;
}

function fuzzyOrLike(
  col: AnyColumn,
  like: string,
  compactTerm: string,
): SQL {
  return or(
    ilike(col, like),
    ...(compactTerm
      ? [sql`similarity(${compactSql(col)}, ${compactTerm}) >= ${FUZZY_THRESHOLD}`]
      : []),
  )!;
}

function snippet(value: string | null | undefined, term: string): string {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const lowerTerm = normalizeAssistantText(term);
  if (text.length <= 120) return text;
  const idx = text.toLowerCase().indexOf(lowerTerm);
  if (idx < 0) return `${text.slice(0, 120)}...`;
  const start = Math.max(0, idx - 40);
  const end = Math.min(text.length, idx + lowerTerm.length + 40);
  return `${start > 0 ? "..." : ""}${text.slice(start, end)}${end < text.length ? "..." : ""}`;
}

function q(value: string): string {
  return encodeURIComponent(value);
}

function shapeDealSummary(deal: NonNullable<Awaited<ReturnType<typeof loadDealById>>>) {
  return {
    id: deal.id,
    title: deal.title,
    status: deal.status,
    value: deal.value,
    currency: deal.currency,
    owner: deal.ownerName,
    organization: deal.organizationName,
    person: deal.personName,
    stage: deal.stageName,
    expectedCloseDate: deal.expectedCloseDate,
    updateTime: deal.updateTime,
  };
}

function shapeNoteSummary(note: {
  id: number;
  content: string;
  addTime: Date | null;
  updateTime: Date | null;
  userName: string | null;
  dealTitle?: string | null;
  personName?: string | null;
  organizationName?: string | null;
}) {
  return {
    id: note.id,
    content: snippet(note.content, ""),
    author: note.userName,
    relatedName: note.dealTitle ?? note.personName ?? note.organizationName ?? null,
    addTime: note.addTime,
    updateTime: note.updateTime,
  };
}

function shapeActivitySummary(activity: {
  id: number;
  subject: string;
  note: string | null;
  type: string;
  done: boolean;
  dueDate: string | null;
  ownerName: string | null;
  dealTitle?: string | null;
  personName?: string | null;
  organizationName?: string | null;
  updateTime: Date | null;
}) {
  return {
    id: activity.id,
    subject: activity.subject,
    note: activity.note ? snippet(activity.note, "") : null,
    type: activity.type,
    done: activity.done,
    dueDate: activity.dueDate,
    owner: activity.ownerName,
    relatedName:
      activity.dealTitle ?? activity.personName ?? activity.organizationName ?? null,
    updateTime: activity.updateTime,
  };
}

export async function searchCrm(
  rawTerm: string,
  options: AssistantSearchOptions = {},
): Promise<{ items: AssistantSearchCandidate[]; total: number; truncated: boolean }> {
  const term = rawTerm.trim().slice(0, 120);
  if (!term) return { items: [], total: 0, truncated: false };

  const limit = clampLimit(options.limit);
  const recordTypes = new Set<RecordFilter>(options.recordTypes ?? []);
  const include = (type: RecordFilter) => recordTypes.size === 0 || recordTypes.has(type);
  const like = `%${escapeLike(term)}%`;
  const compactTerm = compactAssistantText(term);
  const personPhone = phoneMatch(personsTable.phone, term);

  const tasks: Array<Promise<CandidateForScoring[]>> = [];

  if (include("deal")) {
    tasks.push(
      db
        .select({
          id: dealsTable.id,
          title: dealsTable.title,
          status: dealsTable.status,
          comments: dealsTable.comments,
          updateTime: dealsTable.updateTime,
          ownerName: usersTable.name,
          organizationName: organizationsTable.name,
          personName: personsTable.name,
        })
        .from(dealsTable)
        .leftJoin(usersTable, eq(dealsTable.ownerId, usersTable.id))
        .leftJoin(organizationsTable, eq(dealsTable.organizationId, organizationsTable.id))
        .leftJoin(personsTable, eq(dealsTable.personId, personsTable.id))
        .where(
          and(
            ne(dealsTable.status, "deleted"),
            eq(dealsTable.archived, false),
            or(
              fuzzyOrLike(dealsTable.title, like, compactTerm),
              fuzzyOrLike(organizationsTable.name, like, compactTerm),
              fuzzyOrLike(personsTable.name, like, compactTerm),
              ilike(dealsTable.comments, like),
            ),
          ),
        )
        .orderBy(desc(dealsTable.updateTime))
        .limit(SEARCH_LIMIT_MAX)
        .then((rows) =>
          rows.map((row) => ({
            recordType: "deal" as const,
            recordId: row.id,
            title: row.title,
            // Guard each check against an empty compactTerm (e.g. a
            // punctuation-only search) — `"".includes("")` is always true,
            // which would otherwise mislabel every row as "Organization".
            matchedField:
              !!compactTerm && row.organizationName && compactAssistantText(row.organizationName).includes(compactTerm)
                ? "Organization"
                : !!compactTerm && row.personName && compactAssistantText(row.personName).includes(compactTerm)
                  ? "Person"
                  : "Title",
            snippet: snippet(row.organizationName ?? row.personName ?? row.comments ?? row.title, term),
            relatedName: row.organizationName ?? row.personName ?? null,
            href: `/deal/${row.id}`,
            timestamp: row.updateTime ?? null,
            ownerName: row.ownerName ?? null,
            score: 0,
            scoreBand: "low" as const,
            searchTexts: [
              row.title,
              row.organizationName ?? "",
              row.personName ?? "",
              row.comments ?? "",
            ],
          })),
        ),
    );
  }

  if (include("person")) {
    tasks.push(
      db
        .select({
          id: personsTable.id,
          name: personsTable.name,
          email: personsTable.email,
          phone: personsTable.phone,
          updateTime: personsTable.updateTime,
          ownerName: usersTable.name,
          organizationName: organizationsTable.name,
        })
        .from(personsTable)
        .leftJoin(usersTable, eq(personsTable.ownerId, usersTable.id))
        .leftJoin(organizationsTable, eq(personsTable.organizationId, organizationsTable.id))
        .where(
          or(
            fuzzyOrLike(personsTable.name, like, compactTerm),
            ilike(personsTable.email, like),
            ...(personPhone ? [personPhone] : []),
          ),
        )
        .orderBy(desc(personsTable.updateTime))
        .limit(SEARCH_LIMIT_MAX)
        .then((rows) =>
          rows.map((row) => {
            const phoneHit =
              phoneNsn(term).length >= PHONE_MIN_NSN &&
              row.phone &&
              phoneNsn(row.phone).includes(phoneNsn(term));
            return {
              recordType: "person" as const,
              recordId: row.id,
              title: row.name,
              matchedField: phoneHit
                ? "Phone"
                : row.email && normalizeAssistantText(row.email).includes(normalizeAssistantText(term))
                  ? "Email"
                  : "Name",
              snippet: phoneHit ? row.phone ?? "" : snippet(row.email || row.name, term),
              relatedName: row.organizationName ?? null,
              href: `/contacts?tab=persons&focus=${row.id}&q=${q(row.name)}`,
              timestamp: row.updateTime ?? null,
              ownerName: row.ownerName ?? null,
              score: 0,
              scoreBand: "low" as const,
              searchTexts: [row.name, row.email ?? "", row.phone ?? "", row.organizationName ?? ""],
            };
          }),
        ),
    );
  }

  if (include("organization")) {
    tasks.push(
      db
        .select({
          id: organizationsTable.id,
          name: organizationsTable.name,
          address: organizationsTable.address,
          updateTime: organizationsTable.updateTime,
          ownerName: usersTable.name,
        })
        .from(organizationsTable)
        .leftJoin(usersTable, eq(organizationsTable.ownerId, usersTable.id))
        .where(or(fuzzyOrLike(organizationsTable.name, like, compactTerm), ilike(organizationsTable.address, like)))
        .orderBy(desc(organizationsTable.updateTime))
        .limit(SEARCH_LIMIT_MAX)
        .then((rows) =>
          rows.map((row) => ({
            recordType: "organization" as const,
            recordId: row.id,
            title: row.name,
            matchedField:
              row.address && normalizeAssistantText(row.address).includes(normalizeAssistantText(term))
                ? "Address"
                : "Name",
            snippet: snippet(row.address || row.name, term),
            relatedName: null,
            href: `/contacts?tab=organizations&focus=${row.id}&q=${q(row.name)}`,
            timestamp: row.updateTime ?? null,
            ownerName: row.ownerName ?? null,
            score: 0,
            scoreBand: "low" as const,
            searchTexts: [row.name, row.address ?? ""],
          })),
        ),
    );
  }

  if (include("activity")) {
    tasks.push(
      activityQuery()
        .where(
          and(
            eq(activitiesTable.draft, false),
            or(
              fuzzyOrLike(activitiesTable.subject, like, compactTerm),
              ilike(activitiesTable.note, like),
            ),
          ),
        )
        .orderBy(desc(activitiesTable.updateTime))
        .limit(SEARCH_LIMIT_MAX)
        .then((rows) =>
          rows.map((row) => ({
            recordType: "activity" as const,
            recordId: row.id,
            title: row.subject,
            matchedField:
              row.note && normalizeAssistantText(row.note).includes(normalizeAssistantText(term))
                ? "Note"
                : "Subject",
            snippet: snippet(row.note || row.subject, term),
            relatedName: row.dealTitle ?? row.personName ?? null,
            href: row.dealId
              ? `/deal/${row.dealId}?focus=activity-${row.id}`
              : `/activities?focus=${row.id}&q=${q(row.subject)}`,
            timestamp: row.updateTime ?? null,
            ownerName: row.ownerName ?? null,
            score: 0,
            scoreBand: "low" as const,
            searchTexts: [row.subject, row.note ?? "", row.dealTitle ?? "", row.personName ?? ""],
          })),
        ),
    );
  }

  if (include("note")) {
    tasks.push(
      db
        .select({
          id: notesTable.id,
          content: notesTable.content,
          dealId: notesTable.dealId,
          personId: notesTable.personId,
          orgId: notesTable.orgId,
          updateTime: notesTable.updateTime,
          userName: usersTable.name,
          dealTitle: dealsTable.title,
          personName: personsTable.name,
          orgName: organizationsTable.name,
        })
        .from(notesTable)
        .leftJoin(usersTable, eq(notesTable.userId, usersTable.id))
        .leftJoin(dealsTable, eq(notesTable.dealId, dealsTable.id))
        .leftJoin(personsTable, eq(notesTable.personId, personsTable.id))
        .leftJoin(organizationsTable, eq(notesTable.orgId, organizationsTable.id))
        .where(
          and(
            eq(notesTable.activeFlag, true),
            eq(notesTable.draft, false),
            ilike(notesTable.content, like),
          ),
        )
        .orderBy(desc(notesTable.updateTime))
        .limit(SEARCH_LIMIT_MAX)
        .then((rows) =>
          rows.map((row) => {
            const related = row.dealTitle ?? row.personName ?? row.orgName ?? null;
            const href = row.dealId
              ? `/deal/${row.dealId}?focus=note-${row.id}`
              : row.personId
                ? `/contacts?tab=persons&focus=${row.personId}`
                : row.orgId
                  ? `/contacts?tab=organizations&focus=${row.orgId}`
                  : `/search?q=${q(term)}`;
            return {
              recordType: "note" as const,
              recordId: row.id,
              title: related ? `Note on ${related}` : "Note",
              matchedField: "Note",
              snippet: snippet(row.content, term),
              relatedName: related,
              href,
              timestamp: row.updateTime ?? null,
              ownerName: row.userName ?? null,
              score: 0,
              scoreBand: "low" as const,
              searchTexts: [row.content, related ?? ""],
            };
          }),
        ),
    );
  }

  const groups = await Promise.all(tasks);
  const ranked = rankAssistantCandidates(term, groups.flat()).filter((item) => item.score > 0);
  return {
    items: ranked.slice(0, limit),
    total: ranked.length,
    truncated: ranked.length > limit,
  };
}

async function loadRecentNotes(args: {
  dealIds?: number[];
  personIds?: number[];
  orgIds?: number[];
}) {
  const conditions: SQL[] = [eq(notesTable.activeFlag, true), eq(notesTable.draft, false)];
  const ors: SQL[] = [];
  if (args.dealIds?.length) ors.push(inArray(notesTable.dealId, args.dealIds));
  if (args.personIds?.length) ors.push(inArray(notesTable.personId, args.personIds));
  if (args.orgIds?.length) ors.push(inArray(notesTable.orgId, args.orgIds));
  if (!ors.length) return [];
  const rows = await db
    .select({
      id: notesTable.id,
      content: notesTable.content,
      addTime: notesTable.addTime,
      updateTime: notesTable.updateTime,
      userName: usersTable.name,
      dealTitle: dealsTable.title,
      personName: personsTable.name,
      organizationName: organizationsTable.name,
    })
    .from(notesTable)
    .leftJoin(usersTable, eq(notesTable.userId, usersTable.id))
    .leftJoin(dealsTable, eq(notesTable.dealId, dealsTable.id))
    .leftJoin(personsTable, eq(notesTable.personId, personsTable.id))
    .leftJoin(organizationsTable, eq(notesTable.orgId, organizationsTable.id))
    .where(and(...conditions, or(...ors)!))
    .orderBy(desc(notesTable.updateTime), desc(notesTable.id))
    .limit(RECENT_NOTES_LIMIT);
  return rows.map(shapeNoteSummary);
}

async function loadRecentActivities(args: {
  dealIds?: number[];
  personIds?: number[];
  orgIds?: number[];
}) {
  const ors: SQL[] = [];
  if (args.dealIds?.length) ors.push(inArray(activitiesTable.dealId, args.dealIds));
  if (args.personIds?.length) ors.push(inArray(activitiesTable.personId, args.personIds));
  if (args.orgIds?.length) ors.push(inArray(activitiesTable.orgId, args.orgIds));
  if (!ors.length) return [];
  const rows = await db
    .select({
      id: activitiesTable.id,
      subject: activitiesTable.subject,
      note: activitiesTable.note,
      type: activitiesTable.type,
      done: activitiesTable.done,
      dueDate: activitiesTable.dueDate,
      updateTime: activitiesTable.updateTime,
      ownerName: usersTable.name,
      dealTitle: dealsTable.title,
      personName: personsTable.name,
      organizationName: organizationsTable.name,
    })
    .from(activitiesTable)
    .leftJoin(usersTable, eq(activitiesTable.ownerId, usersTable.id))
    .leftJoin(dealsTable, eq(activitiesTable.dealId, dealsTable.id))
    .leftJoin(personsTable, eq(activitiesTable.personId, personsTable.id))
    .leftJoin(organizationsTable, eq(activitiesTable.orgId, organizationsTable.id))
    .where(and(eq(activitiesTable.draft, false), or(...ors)!))
    .orderBy(desc(activitiesTable.updateTime), desc(activitiesTable.id))
    .limit(RECENT_ACTIVITIES_LIMIT);
  return rows.map(shapeActivitySummary);
}

async function loadRelatedDeals(where: SQL) {
  const rows = await dealQuery()
    .where(where)
    .orderBy(desc(dealsTable.updateTime), desc(dealsTable.id))
    .limit(RELATED_DEALS_LIMIT);
  return rows.map(shapeDealSummary);
}

export async function getRecordContext(
  recordType: AssistantRecordType,
  recordId: number,
): Promise<AssistantRecordContext | null> {
  switch (recordType) {
    case "deal": {
      const deal = await loadDealById(recordId);
      if (!deal) return null;
      const [recentNotes, recentActivities] = await Promise.all([
        loadRecentNotes({ dealIds: [deal.id] }),
        loadRecentActivities({ dealIds: [deal.id] }),
      ]);
      return {
        recordType,
        recordId,
        title: deal.title,
        summary: shapeDealSummary(deal),
        recentNotes,
        recentActivities,
      };
    }
    case "organization": {
      const org = await loadOrganizationById(recordId);
      if (!org) return null;
      const [relatedDeals, recentNotes, recentActivities] = await Promise.all([
        loadRelatedDeals(eq(dealsTable.organizationId, org.id)),
        loadRecentNotes({ orgIds: [org.id] }),
        loadRecentActivities({ orgIds: [org.id] }),
      ]);
      const dealIds = relatedDeals.map((deal) => deal.id);
      const [dealNotes, dealActivities] = await Promise.all([
        dealIds.length ? loadRecentNotes({ dealIds }) : Promise.resolve([]),
        dealIds.length ? loadRecentActivities({ dealIds }) : Promise.resolve([]),
      ]);
      return {
        recordType,
        recordId,
        title: org.name,
        summary: {
          id: org.id,
          name: org.name,
          address: org.address,
          owner: org.ownerName,
          dealCount: org.dealCount,
          personCount: org.personCount,
        },
        relatedDeals,
        recentNotes: dedupeById([...recentNotes, ...dealNotes]).slice(0, RECENT_NOTES_LIMIT),
        recentActivities: dedupeById([...recentActivities, ...dealActivities]).slice(
          0,
          RECENT_ACTIVITIES_LIMIT,
        ),
      };
    }
    case "person": {
      const person = await loadPersonById(recordId);
      if (!person) return null;
      const relatedDeals = await loadRelatedDeals(
        eq(dealsTable.personId, person.id),
      );
      const dealIds = relatedDeals.map((deal) => deal.id);
      const [recentNotes, recentActivities] = await Promise.all([
        loadRecentNotes({ personIds: [person.id], dealIds }),
        loadRecentActivities({ personIds: [person.id], dealIds }),
      ]);
      return {
        recordType,
        recordId,
        title: person.name,
        summary: {
          id: person.id,
          name: person.name,
          email: person.email,
          phone: person.phone,
          owner: person.ownerName,
          organization: person.organizationName,
          dealCount: person.dealCount,
        },
        relatedDeals,
        recentNotes,
        recentActivities,
      };
    }
    case "activity": {
      const activity = await activityQuery().where(eq(activitiesTable.id, recordId)).then((rows) => rows[0] ?? null);
      if (!activity || activity.draft) return null;
      return {
        recordType,
        recordId,
        title: activity.subject,
        summary: shapeActivitySummary({
          ...activity,
          organizationName: null,
        }),
        relatedDeals:
          activity.dealId != null
            ? await loadRelatedDeals(eq(dealsTable.id, activity.dealId))
            : undefined,
      };
    }
    case "note": {
      const note = await noteQuery().where(eq(notesTable.id, recordId)).then((rows) => rows[0] ?? null);
      if (!note || note.draft) return null;
      const relatedDeal =
        note.dealId != null ? await loadDealById(note.dealId) : null;
      return {
        recordType,
        recordId,
        title: note.content.length > 80 ? `${note.content.slice(0, 80)}...` : note.content,
        summary: {
          id: note.id,
          content: note.content,
          userName: note.userName,
          addTime: note.addTime,
          updateTime: note.updateTime,
          dealId: note.dealId,
          personId: note.personId,
          orgId: note.orgId,
        },
        relatedDeals: relatedDeal ? [shapeDealSummary(relatedDeal)] : undefined,
      };
    }
    default:
      return null;
  }
}

function dedupeById<T extends { id: number }>(items: T[]): T[] {
  const seen = new Set<number>();
  const out: T[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}
