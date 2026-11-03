import { alias } from "drizzle-orm/pg-core";
import {
  and,
  eq,
  asc,
  desc,
  exists,
  getTableColumns,
  ilike,
  inArray,
  sql,
  type SQL,
  type AnyColumn,
} from "drizzle-orm";
import {
  db,
  dealsTable,
  usersTable,
  personsTable,
  organizationsTable,
  stagesTable,
  activitiesTable,
  notesTable,
  changeEventsTable,
} from "@workspace/db";
import {
  FILTER_FIELD_MAP,
  decodeFilters,
  isFilterGroup,
  countConditions,
  maxDepth,
  type FilterGroup,
  type FilterCondition,
  type FilterFieldName,
  groupReferencesField,
} from "@workspace/deals-filter";
import { APP_TIMEZONE } from "./assistant-dates";

// ---------------------------------------------------------------------------
// Phone normalization — make search format-insensitive.
//
// Stored numbers are compared on their digits with leading zeros dropped
// (`phoneDigits`), which removes formatting, an international `00` and a trunk
// `0`: `+44 7700 900123`, `0044 7700900123` and `447700900123` all become
// `447700900123`. `phoneDigitsSql` is its SQL mirror, kept byte-for-byte
// aligned with the functional index `persons_phone_digits_trgm` (migration
// 0002) so the planner can use it instead of scanning.
//
// A search term is reduced further (`phoneNsn`): when PHONE_COUNTRY_CODE is
// set (e.g. `44`), a leading country code is dropped too, giving the national
// number `7700900123`. A substring match of that against the stored digits
// finds the contact whether it was saved as `07700 900123` or `+44 7700 900123`.
// Without PHONE_COUNTRY_CODE nothing is assumed about the country, so a
// national-format search still finds international-format numbers, but not
// the other way round.
// ---------------------------------------------------------------------------

const PHONE_COUNTRY_CODE = (process.env.PHONE_COUNTRY_CODE ?? "").replace(/[^0-9]/g, "");

export function phoneDigits(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.replace(/[^0-9]/g, "").replace(/^0+/, "");
}

/** `phoneDigits` with the configured country code (if any) dropped. */
export function phoneNsn(raw: string | null | undefined): string {
  const digits = phoneDigits(raw);
  if (PHONE_COUNTRY_CODE && digits.startsWith(PHONE_COUNTRY_CODE)) {
    return digits.slice(PHONE_COUNTRY_CODE.length).replace(/^0+/, "");
  }
  return digits;
}

/** The forms `nsn` is stored under: national, and with the country code. */
export function phoneDigitsVariants(nsn: string): string[] {
  return PHONE_COUNTRY_CODE ? [nsn, PHONE_COUNTRY_CODE + nsn] : [nsn];
}

/**
 * SQL expression computing `phoneDigits(col)`; the literal mirror of the JS
 * above. Kept byte-for-byte identical to the functional index in migration 0002.
 */
export function phoneDigitsSql(col: AnyColumn): SQL<string> {
  return sql<string>`ltrim(regexp_replace(coalesce(${col}, ''), '[^0-9]', '', 'g'), '0')`;
}

// A query is treated as a phone lookup once its NSN has at least this many
// digits — enough for the trigram index to engage and to avoid matching every
// contact on one or two stray digits.
export const PHONE_MIN_NSN = 3;

/**
 * If `term` looks like a phone number, return the SQL predicate matching it
 * against `col`'s normalized form; otherwise null (so callers OR it in only
 * when relevant).
 */
export function phoneMatch(col: AnyColumn, term: string): SQL | null {
  const nsn = phoneNsn(term);
  if (nsn.length < PHONE_MIN_NSN) return null;
  return sql`${phoneDigitsSql(col)} ilike ${"%" + nsn + "%"}`;
}

/**
 * Escape LIKE metacharacters so a query like "100%" or "_" matches literally
 * instead of acting as a wildcard. Postgres' default escape is backslash.
 */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, "\\$&");
}

/**
 * OR-able name/email/phone match conditions for a person, reused by every
 * free-text search that includes contact fields (Persons' own search and
 * Deals' search-by-linked-contact) so the three sites stay in sync.
 */
export function personSearchConditions(q: string): SQL[] {
  const term = `%${escapeLike(q)}%`;
  const phone = phoneMatch(personsTable.phone, q);
  return [
    ilike(personsTable.name, term),
    ilike(personsTable.email, term),
    ilike(personsTable.jobTitle, term),
    ...(phone ? [phone] : []),
  ];
}

/**
 * Archived deals are read-only — linked writes (activities, notes, custom
 * field values) check this before mutating. Missing deal reads as archived
 * so a bad id can't slip a write through.
 */
export async function isDealArchived(
  dealId: number | null | undefined,
): Promise<boolean> {
  if (dealId == null) return false;
  const [row] = await db
    .select({ archived: dealsTable.archived })
    .from(dealsTable)
    .where(eq(dealsTable.id, dealId));
  return row ? row.archived : true;
}

export const ARCHIVED_DEAL_ERROR =
  "This deal is archived and read-only. Restore it to make changes.";

// ---------------------------------------------------------------------------
// Shared list helpers — keep every paginated endpoint consistent.
// ---------------------------------------------------------------------------

export interface PageSpec {
  page: number;
  limit: number;
  offset: number;
}

export function parsePagination(
  q: Record<string, unknown>,
  maxLimit = 100,
): PageSpec {
  const page = Math.max(1, Math.floor(Number(q.page)) || 1);
  const limit = Math.min(
    maxLimit,
    Math.max(1, Math.floor(Number(q.limit)) || 50),
  );
  return { page, limit, offset: (page - 1) * limit };
}

// Boolean query params are validated by the generated zod schemas with
// `zod.coerce.boolean()` — i.e. `Boolean(value)`. Query values are always
// strings, and the string `"false"` coerces to `true`
// (`Boolean("false") === true`), silently inverting the filter. For params
// whose contract is "omitted/false = off" (deals' `archived`/`rotting`, the
// activities/notes `includeDrafts`), a falsy string must behave exactly like
// an absent param. Strip those keys before validation so coercion only ever
// sees a truthy string (→ true) or nothing (→ undefined). Returns a shallow
// copy; `req.query` is left untouched.
const FALSY_QUERY_BOOLEANS = new Set(["false", "0", ""]);
export function stripFalsyBooleanParams(
  query: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  const out = { ...query };
  for (const key of keys) {
    const value = out[key];
    if (typeof value === "string" && FALSY_QUERY_BOOLEANS.has(value.toLowerCase()))
      delete out[key];
  }
  return out;
}

/**
 * Resolve a `field:direction` sort spec against an allowlist of columns.
 * Nulls always sort last (Postgres would otherwise lead a `desc` sort with
 * every empty value), and `tiebreaker` is appended so rows with equal sort
 * values keep a deterministic order — without it, offset pagination repeats
 * and skips rows across pages (same reason buildDealOrderBy ends with id).
 */
export function resolveOrderBy(
  spec: string | undefined,
  columns: Record<string, AnyColumn | SQL>,
  fallback: SQL[],
  tiebreaker: AnyColumn,
): SQL[] {
  const [field, dir] = spec ? spec.split(":") : [];
  const col = field ? columns[field] : undefined;
  const primary = col
    ? [sql`${col} ${sql.raw(dir === "asc" ? "asc" : "desc")} nulls last`]
    : fallback;
  return [...primary, asc(tiebreaker)];
}

const dealOwner = alias(usersTable, "deal_owner");

// Most-recent activity timestamp for a deal (correlated subquery). Used both as
// a returned column and inside the rotting computation. Drafts are excluded so
// saving a draft never refreshes a deal's freshness or un-rots it.
const lastActivityExpr = sql<Date | null>`(select max(${activitiesTable.addTime}) from ${activitiesTable} where ${activitiesTable.dealId} = ${dealsTable.id} and ${activitiesTable.draft} = false)`;

// Earliest DUE date among a deal's OPEN activities: the deal's next
// action item. Open = not done, not draft, and dated. An overdue open activity
// (due_date in the past) is still the next action, so no lower bound on the
// date — the client colors it red/amber/green from the date, grey when null.
// `due_date` is a plain SQL `date` (mode:"string"), so this returns a date
// string, not a timestamp. Correlated subquery — adds no join, so it stays a
// dealQuery-only select (dealCountQuery/dealSummaryTotals need not mirror it).
const nextActivityDueExpr = sql<string | null>`(select min(${activitiesTable.dueDate}) from ${activitiesTable} where ${activitiesTable.dealId} = ${dealsTable.id} and ${activitiesTable.draft} = false and ${activitiesTable.done} = false and ${activitiesTable.dueDate} is not null)`;

// A deal is "rotting" when it is open, its stage defines a rotting threshold,
// and the most recent of (stage change, last activity) is older than the
// threshold. A null rottingDays means deals in that stage never rot.
// Exported so list/count can also filter on it (rotting=true query param).
export const isRottingExpr = sql<boolean>`(
  ${dealsTable.status} = 'open'
  and ${stagesTable.rottingDays} is not null
  and greatest(
    coalesce(${dealsTable.stageChangeTime}, ${dealsTable.addTime}),
    coalesce(${lastActivityExpr}, ${dealsTable.addTime})
  ) < (now() - (${stagesTable.rottingDays} * interval '1 day'))
)`;

export function dealQuery() {
  return db
    .select({
      ...getTableColumns(dealsTable),
      ownerName: dealOwner.name,
      personName: personsTable.name,
      organizationName: organizationsTable.name,
      stageName: stagesTable.name,
      lastActivityTime: lastActivityExpr,
      nextActivityDueDate: nextActivityDueExpr,
      isRotting: isRottingExpr,
    })
    .from(dealsTable)
    .leftJoin(dealOwner, eq(dealsTable.ownerId, dealOwner.id))
    .leftJoin(personsTable, eq(dealsTable.personId, personsTable.id))
    .leftJoin(
      organizationsTable,
      eq(dealsTable.organizationId, organizationsTable.id),
    )
    .leftJoin(stagesTable, eq(dealsTable.stageId, stagesTable.id))
    .$dynamic();
}

// Count query mirrors the joins used by dealQuery so that compiled filters that
// reference joined columns (organization name, stage) remain valid.
export function dealCountQuery() {
  return db
    .select({ count: sql<number>`count(*)::int` })
    .from(dealsTable)
    .leftJoin(dealOwner, eq(dealsTable.ownerId, dealOwner.id))
    .leftJoin(personsTable, eq(dealsTable.personId, personsTable.id))
    .leftJoin(
      organizationsTable,
      eq(dealsTable.organizationId, organizationsTable.id),
    )
    .leftJoin(stagesTable, eq(dealsTable.stageId, stagesTable.id))
    .$dynamic();
}

/**
 * Per-currency value totals over a filtered deal set: raw sum plus a
 * stage-probability-weighted sum. Mirrors the dealQuery joins so compiled
 * filters that reference joined columns stay valid.
 */
export function dealSummaryTotals(where: SQL | undefined) {
  return db
    .select({
      currency: dealsTable.currency,
      count: sql<number>`count(*)::int`,
      value: sql<number>`coalesce(sum(${dealsTable.value}), 0)::float8`,
      weightedValue: sql<number>`coalesce(sum(${dealsTable.value} * coalesce(${stagesTable.probability}, 100) / 100.0), 0)::float8`,
    })
    .from(dealsTable)
    .leftJoin(dealOwner, eq(dealsTable.ownerId, dealOwner.id))
    .leftJoin(personsTable, eq(dealsTable.personId, personsTable.id))
    .leftJoin(
      organizationsTable,
      eq(dealsTable.organizationId, organizationsTable.id),
    )
    .leftJoin(stagesTable, eq(dealsTable.stageId, stagesTable.id))
    .where(where)
    .groupBy(dealsTable.currency)
    .orderBy(sql`count(*) desc`);
}

export async function loadDealById(id: number) {
  const [deal] = await dealQuery().where(eq(dealsTable.id, id));
  return deal ?? null;
}

// ---------------------------------------------------------------------------
// Curated deal analytics for Ask AI. A single, correct aggregate the
// assistant calls instead of writing ad-hoc SQL, so counts/totals are right by
// construction: deleted+archived deals are excluded by default, value is summed
// per currency (never mixed), and date ranges use app-time-zone calendar days on the
// chosen timestamp. Answers "how many deals added in the last 7 days", "won
// value by owner this quarter", "open pipeline value by stage", etc.
// ---------------------------------------------------------------------------

export type DealStatDimension = "none" | "owner" | "stage" | "status" | "month";

export interface DealStatFilters {
  status?: "open" | "won" | "lost";
  ownerId?: number;
  pipelineId?: number;
  /** Which timestamp the date range applies to: 'created' = add_time, 'won' = won_time. */
  dateField?: "created" | "won";
  /** Inclusive app-time-zone calendar day (YYYY-MM-DD). */
  dateFrom?: string;
  dateTo?: string;
}

export interface DealStatRow {
  key: string | null;
  label: string | null;
  currency: string;
  count: number;
  value: number;
}

export async function dealStats(
  filters: DealStatFilters,
  groupBy: DealStatDimension,
): Promise<DealStatRow[]> {
  const dateCol = filters.dateField === "won" ? sql`d.won_time` : sql`d.add_time`;
  // Default lens: exclude deleted + archived unless a specific status is asked for.
  const statusFilter = filters.status
    ? sql` and d.status = ${filters.status}`
    : sql` and d.status <> 'deleted'`;
  const ownerFilter =
    filters.ownerId != null ? sql` and d.owner_id = ${filters.ownerId}` : sql``;
  const pipelineFilter =
    filters.pipelineId != null ? sql` and d.pipeline_id = ${filters.pipelineId}` : sql``;
  const fromFilter = filters.dateFrom
    ? sql` and (${dateCol} at time zone ${APP_TZ_SQL})::date >= ${filters.dateFrom}::date`
    : sql``;
  const toFilter = filters.dateTo
    ? sql` and (${dateCol} at time zone ${APP_TZ_SQL})::date <= ${filters.dateTo}::date`
    : sql``;

  const dim =
    groupBy === "owner"
      ? { key: sql`d.owner_id::text`, label: sql`coalesce(u.name, 'Unassigned')` }
      : groupBy === "stage"
        ? { key: sql`d.stage_id::text`, label: sql`coalesce(s.name, 'Unknown')` }
        : groupBy === "status"
          ? { key: sql`d.status::text`, label: sql`d.status::text` }
          : groupBy === "month"
            ? {
                key: sql`to_char((${dateCol} at time zone ${APP_TZ_SQL}), 'YYYY-MM')`,
                label: sql`to_char((${dateCol} at time zone ${APP_TZ_SQL}), 'YYYY-MM')`,
              }
            : null;

  const dimSelect = dim
    ? sql`${dim.key} as key, ${dim.label} as label,`
    : sql`null::text as key, null::text as label,`;
  const dimGroup = dim ? sql`${dim.key}, ${dim.label},` : sql``;

  const result = await db.execute(sql`
    select ${dimSelect} d.currency as currency,
           count(*)::int as count,
           coalesce(sum(d.value), 0)::float8 as value
    from deals d
    left join users u on u.id = d.owner_id
    left join stages s on s.id = d.stage_id
    where d.archived = false${statusFilter}${ownerFilter}${pipelineFilter}${fromFilter}${toFilter}
    group by ${dimGroup} d.currency
    order by count(*) desc
    limit 200
  `);
  return result.rows as unknown as DealStatRow[];
}

// --- Ask AI deal drill-down + owner lookup -----------------------------------
// These let the assistant LIST the specific deals behind a deal_stats count and
// resolve an internal team member (deal owner) by name. All read-only.

/**
 * A created/won date-range condition on the deals table, using the SAME
 * app-time-zone calendar-day bounds as `dealStats`, so a count and a list over the
 * same filter agree. Returns undefined when no bounds are given.
 */
export function dealDateRangeCondition(
  dateField: "created" | "won" | undefined,
  dateFrom?: string,
  dateTo?: string,
): SQL | undefined {
  const col = dateField === "won" ? dealsTable.wonTime : dealsTable.addTime;
  const parts: SQL[] = [];
  if (dateFrom) parts.push(sql`(${col} at time zone ${APP_TZ_SQL})::date >= ${dateFrom}::date`);
  if (dateTo) parts.push(sql`(${col} at time zone ${APP_TZ_SQL})::date <= ${dateTo}::date`);
  return parts.length ? and(...parts) : undefined;
}

/**
 * Resolve a pipeline-stage name (trimmed, case-insensitive, substring-tolerant)
 * to the matching `stages.id` values across all pipelines. Empty when nothing
 * matches — the caller reports the valid stage names rather than a silent empty
 * result.
 */
export async function resolveStageIdsByName(name: string): Promise<number[]> {
  const term = name.trim();
  if (!term) return [];
  // Prefer an exact (case-insensitive) name match so "Initial Contact" resolves
  // to that stage only, not every stage whose name merely CONTAINS the term
  // (which would silently union "Re: Initial Contact" etc. into one count).
  // Fall back to substring matching when nothing matches exactly, preserving
  // fuzzy tolerance for partial names. Same-named stages across pipelines still
  // union — callers that must disambiguate pass a pipelineId.
  const exact = await db
    .select({ id: stagesTable.id })
    .from(stagesTable)
    .where(ilike(stagesTable.name, escapeLike(term)));
  if (exact.length > 0) return exact.map((r) => r.id);
  const rows = await db
    .select({ id: stagesTable.id })
    .from(stagesTable)
    .where(ilike(stagesTable.name, `%${escapeLike(term)}%`));
  return rows.map((r) => r.id);
}

/** Distinct pipeline-stage names, for a helpful "no such stage" message. */
export async function listStageNames(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ name: stagesTable.name })
    .from(stagesTable)
    .orderBy(asc(stagesTable.name));
  return rows.map((r) => r.name).filter((n): n is string => Boolean(n));
}

/**
 * A deal condition (correlated `EXISTS`) that is true when the deal MOVED INTO
 * any of the given stages within the date window, read from the append-only
 * `change_events` log (`field_key = 'stage_id'`, `new_value.id` = the stage
 * entered). This is a stage-TRANSITION predicate — fundamentally different from
 * filtering on a deal's CURRENT stage: a deal that entered the stage in the
 * window and has since moved on still matches.
 *
 * Returned as a condition (not an id list) so callers apply it to `dealQuery()`
 * / `dealCountQuery()` and let the SQL `limit`/`offset` bound the work in one
 * statement — no unbounded intermediate id array. The correlation on
 * `entity_id = deals.id` lets Postgres seek the partial index
 * `change_events_stage_idx` (`(entity_id, changed_at) WHERE field_key='stage_id'`)
 * per deal. `EXISTS` is inherently distinct-by-deal (multiple entries in the
 * window still match once). Date bounds use the shared app-time-zone calendar-day
 * helper (`localDate`) so a "moved into" window agrees with `deal_stats`.
 * Precondition: `stageIds` is non-empty (resolve the name first).
 */
export function movedIntoStageCondition(opts: {
  stageIds: number[];
  dateFrom?: string;
  dateTo?: string;
}): SQL {
  const inner: SQL[] = [
    eq(changeEventsTable.entityType, "deal"),
    eq(changeEventsTable.entityId, dealsTable.id),
    eq(changeEventsTable.fieldKey, "stage_id"),
    inArray(sql`(${changeEventsTable.newValue}->>'id')::int`, opts.stageIds),
  ];
  if (opts.dateFrom) {
    inner.push(sql`${localDate(changeEventsTable.changedAt)} >= ${opts.dateFrom}::date`);
  }
  if (opts.dateTo) {
    inner.push(sql`${localDate(changeEventsTable.changedAt)} <= ${opts.dateTo}::date`);
  }
  return exists(
    db.select({ one: sql`1` }).from(changeEventsTable).where(and(...inner)),
  );
}

export interface OwnerMatch {
  id: number;
  name: string;
  email: string;
  openDealCount: number;
}

/**
 * Resolve an internal team member (deal owner) by name → the matching users
 * plus their open-deal count, most deals first. Only active users are returned
 * (deactivated accounts never resolve as an owner). Exposes name + email only —
 * never password hashes, reset tokens, or other secret columns.
 */
export async function findOwnersByName(name: string, limit = 10): Promise<OwnerMatch[]> {
  const term = name.trim();
  if (!term) return [];
  const openDeals = db
    .select({
      ownerId: dealsTable.ownerId,
      openDealCount: sql<number>`count(*)::int`.as("open_deal_count"),
    })
    .from(dealsTable)
    .where(and(eq(dealsTable.archived, false), eq(dealsTable.status, "open")))
    .groupBy(dealsTable.ownerId)
    .as("open_deals");
  const rows = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      openDealCount: sql<number>`coalesce(${openDeals.openDealCount}, 0)::int`,
    })
    .from(usersTable)
    .leftJoin(openDeals, eq(openDeals.ownerId, usersTable.id))
    .where(
      and(
        ilike(usersTable.name, `%${escapeLike(term)}%`),
        eq(usersTable.activeFlag, true),
      ),
    )
    .orderBy(desc(sql`coalesce(${openDeals.openDealCount}, 0)`), asc(usersTable.id))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    openDealCount: r.openDealCount ?? 0,
  }));
}

// Denormalized deal for outbound webhook payloads: the full flat deal row plus
// owner/person contact details and org/stage names, so webhook consumers can
// act on the deal without a second API call. Kept separate from dealQuery() so
// the list/detail endpoints (and their response types) stay untouched — this
// query adds owner/person email+phone that those endpoints don't need.
export async function loadDealForWebhook(id: number) {
  const [deal] = await db
    .select({
      ...getTableColumns(dealsTable),
      ownerName: dealOwner.name,
      ownerEmail: dealOwner.email,
      ownerPhone: dealOwner.phone,
      personName: personsTable.name,
      personEmail: personsTable.email,
      personPhone: personsTable.phone,
      organizationName: organizationsTable.name,
      stageName: stagesTable.name,
    })
    .from(dealsTable)
    .leftJoin(dealOwner, eq(dealsTable.ownerId, dealOwner.id))
    .leftJoin(personsTable, eq(dealsTable.personId, personsTable.id))
    .leftJoin(
      organizationsTable,
      eq(dealsTable.organizationId, organizationsTable.id),
    )
    .leftJoin(stagesTable, eq(dealsTable.stageId, stagesTable.id))
    .where(eq(dealsTable.id, id));
  return deal ?? null;
}

export type WebhookDeal = Awaited<ReturnType<typeof loadDealForWebhook>>;

const personOwner = alias(usersTable, "person_owner");

// Correlated count expressions — shared between the select list and the sort
// allowlists of the /search endpoints, so "sort by deals/contacts" orders by
// exactly the number displayed.
export const personDealCount = sql<number>`(select count(*)::int from ${dealsTable} where ${dealsTable.personId} = ${personsTable.id} and ${dealsTable.status} <> 'deleted')`;
export const orgDealCount = sql<number>`(select count(*)::int from ${dealsTable} where ${dealsTable.organizationId} = ${organizationsTable.id} and ${dealsTable.status} <> 'deleted')`;
export const orgPersonCount = sql<number>`(select count(*)::int from ${personsTable} where ${personsTable.organizationId} = ${organizationsTable.id})`;

export function personQuery() {
  return db
    .select({
      ...getTableColumns(personsTable),
      ownerName: personOwner.name,
      organizationName: organizationsTable.name,
      dealCount: personDealCount,
    })
    .from(personsTable)
    .leftJoin(personOwner, eq(personsTable.ownerId, personOwner.id))
    .leftJoin(
      organizationsTable,
      eq(personsTable.organizationId, organizationsTable.id),
    )
    .$dynamic();
}

export async function loadPersonById(id: number) {
  const [person] = await personQuery().where(eq(personsTable.id, id));
  return person ?? null;
}

const orgOwner = alias(usersTable, "org_owner");

export function organizationQuery() {
  return db
    .select({
      ...getTableColumns(organizationsTable),
      ownerName: orgOwner.name,
      dealCount: orgDealCount,
      personCount: orgPersonCount,
    })
    .from(organizationsTable)
    .leftJoin(orgOwner, eq(organizationsTable.ownerId, orgOwner.id))
    .$dynamic();
}

export async function loadOrganizationById(id: number) {
  const [org] = await organizationQuery().where(eq(organizationsTable.id, id));
  return org ?? null;
}

const activityOwner = alias(usersTable, "activity_owner");
// Aliased: callers filter on organizationsTable elsewhere, and the deal's org
// join must not collide with a query that already joins it under its own name.
export const activityDealOrg = alias(organizationsTable, "activity_deal_org");

export function activityQuery() {
  return db
    .select({
      ...getTableColumns(activitiesTable),
      dealTitle: dealsTable.title,
      personName: personsTable.name,
      ownerName: activityOwner.name,
      // The deal's CRM organization — NOT activities.orgId, which is the
      // activity's own (often unset) org link.
      dealOrganizationId: dealsTable.organizationId,
      dealOrganizationName: activityDealOrg.name,
    })
    .from(activitiesTable)
    .leftJoin(dealsTable, eq(activitiesTable.dealId, dealsTable.id))
    .leftJoin(personsTable, eq(activitiesTable.personId, personsTable.id))
    .leftJoin(activityOwner, eq(activitiesTable.ownerId, activityOwner.id))
    .leftJoin(
      activityDealOrg,
      eq(dealsTable.organizationId, activityDealOrg.id),
    )
    .$dynamic();
}

export async function loadActivityById(id: number) {
  const [activity] = await activityQuery().where(eq(activitiesTable.id, id));
  return activity ?? null;
}

export function noteQuery() {
  return db
    .select({
      ...getTableColumns(notesTable),
      userName: usersTable.name,
    })
    .from(notesTable)
    .leftJoin(usersTable, eq(notesTable.userId, usersTable.id))
    .$dynamic();
}

export async function loadNoteById(id: number) {
  const [note] = await noteQuery().where(eq(notesTable.id, id));
  return note ?? null;
}

// ---------------------------------------------------------------------------
// Filter DSL -> parameterized SQL compiler.
//
// The shared @workspace/deals-filter package owns the field/operator whitelist
// and the URL encoding; this compiler maps each whitelisted field to a concrete
// column and emits parameterized SQL. Every user-supplied value is bound as a
// parameter (never string-interpolated), so the DSL cannot inject SQL.
// ---------------------------------------------------------------------------

export class DealFilterError extends Error {}

// "date" = timestamptz compared as an app-time-zone calendar date; "dateonly" =
// a plain `date` column compared as-is (AT TIME ZONE would shift it); "list" =
// text[] (labels); "bool" = boolean column or SQL boolean expression.
type FilterColKind =
  | "text"
  | "number"
  | "id"
  | "status"
  | "date"
  | "dateonly"
  | "bool"
  | "list";

// Joined columns (organization/person name) and computed expressions
// (isRotting, lastActivity) are valid because every consumer of the compiled
// SQL — dealQuery, dealCountQuery, dealSummaryTotals — carries the same joins.
const FILTER_COLUMNS: Record<
  FilterFieldName,
  { col: AnyColumn | SQL; kind: FilterColKind }
> = {
  title: { col: dealsTable.title, kind: "text" },
  organization: { col: organizationsTable.name, kind: "text" },
  value: { col: dealsTable.value, kind: "number" },
  pipeline: { col: dealsTable.pipelineId, kind: "id" },
  stage: { col: dealsTable.stageId, kind: "id" },
  owner: { col: dealsTable.ownerId, kind: "id" },
  createdDate: { col: dealsTable.addTime, kind: "date" },
  wonTime: { col: dealsTable.wonTime, kind: "date" },
  status: { col: dealsTable.status, kind: "status" },
  utmKeyword: { col: dealsTable.utmKeyword, kind: "text" },
  lostReason: { col: dealsTable.lostReason, kind: "text" },
  // Identity / references
  id: { col: dealsTable.id, kind: "number" },
  organizationId: { col: dealsTable.organizationId, kind: "number" },
  person: { col: personsTable.name, kind: "text" },
  personId: { col: dealsTable.personId, kind: "number" },
  creatorId: { col: dealsTable.creatorUserId, kind: "number" },
  currency: { col: dealsTable.currency, kind: "text" },
  visibleTo: { col: dealsTable.visibleTo, kind: "text" },
  comments: { col: dealsTable.comments, kind: "text" },
  labels: { col: dealsTable.labels, kind: "list" },
  isRotting: { col: isRottingExpr, kind: "bool" },
  archived: { col: dealsTable.archived, kind: "bool" },
  // Lifecycle timestamps
  expectedCloseDate: { col: dealsTable.expectedCloseDate, kind: "dateonly" },
  updateTime: { col: dealsTable.updateTime, kind: "date" },
  stageChangeTime: { col: dealsTable.stageChangeTime, kind: "date" },
  lostTime: { col: dealsTable.lostTime, kind: "date" },
  closeTime: { col: dealsTable.closeTime, kind: "date" },
  archiveTime: { col: dealsTable.archiveTime, kind: "date" },
  lastActivity: { col: lastActivityExpr, kind: "date" },
  // Source / attribution
  utmSource: { col: dealsTable.utmSource, kind: "text" },
  utmMedium: { col: dealsTable.utmMedium, kind: "text" },
  utmCampaign: { col: dealsTable.utmCampaign, kind: "text" },
  adName: { col: dealsTable.adName, kind: "text" },
  gclid: { col: dealsTable.gclid, kind: "text" },
  fbclid: { col: dealsTable.fbclid, kind: "text" },
  wbraid: { col: dealsTable.wbraid, kind: "text" },
  gbraid: { col: dealsTable.gbraid, kind: "text" },
};

const DEAL_STATUSES = ["open", "won", "lost", "deleted"];

function reqStr(v: unknown): string {
  if (typeof v === "string" && v.length > 0) return v;
  if (typeof v === "number") return String(v);
  throw new DealFilterError("Expected a text value");
}
function reqNum(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n))
    throw new DealFilterError("Expected a numeric value");
  return n;
}
function reqDate(v: unknown): string {
  if (typeof v !== "string" || v.trim() === "") {
    throw new DealFilterError("Expected a date value");
  }
  if (Number.isNaN(new Date(v).getTime())) {
    throw new DealFilterError("Invalid date value");
  }
  return v;
}
function reqPair(v: unknown): [unknown, unknown] {
  if (!Array.isArray(v) || v.length !== 2) {
    throw new DealFilterError("Expected a two-value range");
  }
  return [v[0], v[1]];
}
function reqStatus(v: unknown): string {
  if (typeof v === "string" && DEAL_STATUSES.includes(v)) return v;
  throw new DealFilterError("Invalid status value");
}
function reqBool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  throw new DealFilterError("Expected a boolean value");
}
/** Every date bucket and date filter resolves against the app time zone
 *  (APP_TIMEZONE, default UTC). One constant — the literals must never drift
 *  apart across compilers. */
export const APP_TZ = APP_TIMEZONE;
if (!/^[A-Za-z0-9_+\-/]+$/.test(APP_TZ)) {
  throw new Error(`APP_TIMEZONE is not a valid time zone name: ${APP_TZ}`);
}
/** Escaped SQL literal (not a bind param) so expressions stay
 *  index-matchable; the value comes from configuration (validated above),
 *  never from user input. */
export const APP_TZ_SQL: SQL = sql.raw(`'${APP_TZ}'`);

/** Exported for the Insights compilers, which bucket on the same calendar. */
export function localDate(col: AnyColumn | SQL): SQL {
  return sql`(${col} AT TIME ZONE ${APP_TZ_SQL})::date`;
}

/** Compile one native-field condition. Exported for the Insights compiler,
 *  which walks extended (cf:-aware) groups itself and delegates native
 *  conditions here so the two paths cannot drift. */
export function compileCondition(c: FilterCondition): SQL {
  const def = FILTER_FIELD_MAP[c.field];
  const meta = FILTER_COLUMNS[c.field];
  if (!def || !meta) throw new DealFilterError(`Unknown field: ${c.field}`);
  if (!def.operators.includes(c.operator)) {
    throw new DealFilterError(
      `Operator "${c.operator}" is not allowed for field "${c.field}"`,
    );
  }
  const { col, kind } = meta;
  const op = c.operator;

  if (op === "is_empty") {
    if (kind === "text") return sql`(${col} is null or ${col} = '')`;
    if (kind === "list")
      return sql`(${col} is null or cardinality(${col}) = 0)`;
    return sql`${col} is null`;
  }
  if (op === "is_not_empty") {
    if (kind === "text") return sql`(${col} is not null and ${col} <> '')`;
    if (kind === "list")
      return sql`(${col} is not null and cardinality(${col}) > 0)`;
    return sql`${col} is not null`;
  }

  const v = c.value;
  switch (kind) {
    case "text":
      if (op === "contains")
        return sql`${col} ilike ${`%${escapeLike(reqStr(v))}%`}`;
      // NULL-inclusive, like is_not: a missing value "does not contain" anything.
      if (op === "not_contains") {
        return sql`(${col} is null or ${col} not ilike ${`%${escapeLike(reqStr(v))}%`})`;
      }
      if (op === "is") return sql`${col} = ${reqStr(v)}`;
      if (op === "is_not") return sql`${col} is distinct from ${reqStr(v)}`;
      break;
    case "number":
      if (op === "is") return sql`${col} = ${reqNum(v)}`;
      if (op === "is_not") return sql`${col} is distinct from ${reqNum(v)}`;
      if (op === "gt") return sql`${col} > ${reqNum(v)}`;
      if (op === "lt") return sql`${col} < ${reqNum(v)}`;
      if (op === "between") {
        const [a, b] = reqPair(v);
        return sql`${col} between ${reqNum(a)} and ${reqNum(b)}`;
      }
      break;
    case "id":
      if (op === "is") return sql`${col} = ${reqNum(v)}`;
      if (op === "is_not") return sql`${col} is distinct from ${reqNum(v)}`;
      break;
    case "status":
      if (op === "is") return sql`${col}::text = ${reqStatus(v)}`;
      if (op === "is_not")
        return sql`${col}::text is distinct from ${reqStatus(v)}`;
      break;
    case "date":
    case "dateonly": {
      // timestamptz columns compare as an app-time-zone calendar date; plain
      // `date` columns compare directly (AT TIME ZONE would shift them).
      const expr = kind === "date" ? localDate(col) : sql`${col}`;
      if (op === "is") return sql`${expr} = ${reqDate(v)}::date`;
      if (op === "is_not")
        return sql`${expr} is distinct from ${reqDate(v)}::date`;
      if (op === "gt") return sql`${expr} > ${reqDate(v)}::date`;
      if (op === "lt") return sql`${expr} < ${reqDate(v)}::date`;
      if (op === "between") {
        const [a, b] = reqPair(v);
        return sql`${expr} between ${reqDate(a)}::date and ${reqDate(b)}::date`;
      }
      break;
    }
    case "bool":
      if (op === "is") return sql`${col} = ${reqBool(v)}`;
      break;
    case "list":
      // labels text[]: `is` = has exactly this label; `contains` = any label
      // contains the substring; `is_not` = NULL-safe "does not have it".
      if (op === "is") return sql`${reqStr(v)} = any(${col})`;
      if (op === "is_not")
        return sql`not coalesce(${reqStr(v)} = any(${col}), false)`;
      if (op === "contains")
        return sql`exists (select 1 from unnest(coalesce(${col}, '{}'::text[])) as _label where _label ilike ${`%${escapeLike(reqStr(v))}%`})`;
      break;
  }
  throw new DealFilterError(
    `Operator "${op}" is not supported for field "${c.field}"`,
  );
}

function compileGroup(group: FilterGroup): SQL | undefined {
  const parts: SQL[] = [];
  for (const node of group.conditions) {
    if (isFilterGroup(node)) {
      const nested = compileGroup(node);
      if (nested) parts.push(nested);
    } else {
      parts.push(compileCondition(node));
    }
  }
  if (parts.length === 0) return undefined;
  const sep = group.combinator === "or" ? sql` or ` : sql` and `;
  return sql`(${sql.join(parts, sep)})`;
}

/**
 * Decode a base64url filter from the URL, enforce structural limits, and compile
 * it to parameterized SQL. Returns undefined when there is no filter. Throws
 * DealFilterError on malformed or out-of-whitelist input (callers map to 400).
 */
/**
 * Which of the deals list's default lenses an encoded filter should suppress,
 * so an explicit condition isn't silently contradicted:
 *   - `status`   → references status/lostReason; drop the open-only default.
 *   - `archived` → references archived; drop BOTH the archived=false lens and
 *                  the open-only default (an "Archived is …" filter then behaves
 *                  like the archive view — all statuses of archived deals).
 * Decodes once (the compiler decodes separately) and returns both flags.
 * Malformed input yields all-false (the compiler will throw separately).
 */
export function filterOverrides(encoded?: string | null): {
  status: boolean;
  archived: boolean;
} {
  if (!encoded) return { status: false, archived: false };
  let group: FilterGroup;
  try {
    group = decodeFilters(encoded);
  } catch {
    return { status: false, archived: false };
  }
  return {
    status:
      groupReferencesField(group, "status") ||
      groupReferencesField(group, "lostReason"),
    archived: groupReferencesField(group, "archived"),
  };
}

export function compileDealFilters(
  encoded: string | undefined | null,
): SQL | undefined {
  if (!encoded) return undefined;
  let group: FilterGroup;
  try {
    group = decodeFilters(encoded);
  } catch {
    throw new DealFilterError("Invalid filter encoding");
  }
  if (maxDepth(group) > 5) {
    throw new DealFilterError("Filter nesting is too deep");
  }
  if (countConditions(group) > 100) {
    throw new DealFilterError("Too many filter conditions");
  }
  return compileGroup(group);
}

// ---------------------------------------------------------------------------
// Sort whitelist. Unknown fields fall back to the default order. A deterministic
// secondary sort by id guarantees stable offset pagination.
// ---------------------------------------------------------------------------

// Every column the list can sort by. Kept in sync with the frontend's sortable
// column set (deals-list-view primary columns + deal-native-columns SPECS): a
// column is given a sort arrow on the client ONLY if its id appears here, so the
// two must not drift or a header would sort to no effect. Keys are the column
// ids the client sends (deal-native-columns uses the row field name as the id).
// Every referenced table is joined by dealQuery, and buildDealOrderBy appends a
// nulls-last + id tiebreaker, so joined/nullable columns are safe.
const SORT_COLUMNS: Record<string, AnyColumn | SQL> = {
  // Primary columns
  title: dealsTable.title,
  organization: organizationsTable.name,
  value: dealsTable.value,
  stage: stagesTable.orderIndex,
  owner: dealOwner.name,
  status: dealsTable.status,
  addTime: dealsTable.addTime,
  expectedCloseDate: dealsTable.expectedCloseDate,
  lastActivity: lastActivityExpr,
  // Identity / references
  id: dealsTable.id,
  organizationId: dealsTable.organizationId,
  personName: personsTable.name,
  personId: dealsTable.personId,
  creatorUserId: dealsTable.creatorUserId,
  currency: dealsTable.currency,
  pipelineId: dealsTable.pipelineId,
  stageId: dealsTable.stageId,
  lostReason: dealsTable.lostReason,
  comments: dealsTable.comments,
  visibleTo: dealsTable.visibleTo,
  archived: dealsTable.archived,
  // Timestamps
  updateTime: dealsTable.updateTime,
  stageChangeTime: dealsTable.stageChangeTime,
  wonTime: dealsTable.wonTime,
  lostTime: dealsTable.lostTime,
  closeTime: dealsTable.closeTime,
  archiveTime: dealsTable.archiveTime,
  // Source / attribution
  utmSource: dealsTable.utmSource,
  utmMedium: dealsTable.utmMedium,
  utmCampaign: dealsTable.utmCampaign,
  utmKeyword: dealsTable.utmKeyword,
  adName: dealsTable.adName,
  gclid: dealsTable.gclid,
  fbclid: dealsTable.fbclid,
  wbraid: dealsTable.wbraid,
  gbraid: dealsTable.gbraid,
};

export function buildDealOrderBy(sort: string | undefined | null): SQL[] {
  let col: AnyColumn | SQL | undefined;
  let dir: "asc" | "desc" = "desc";
  if (sort) {
    const [field, d] = sort.split(":");
    if (field && field in SORT_COLUMNS) {
      col = SORT_COLUMNS[field];
      dir = d === "asc" ? "asc" : "desc";
    }
  }
  const order: SQL[] = [];
  order.push(
    col
      ? sql`${col} ${sql.raw(dir)} nulls last`
      : sql`${dealsTable.updateTime} desc nulls last`,
  );
  order.push(sql`${dealsTable.id} asc`);
  return order;
}
