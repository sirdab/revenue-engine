import { and, desc, eq, ilike, ne, or } from "drizzle-orm";
import {
  db,
  dealsTable,
  personsTable,
  organizationsTable,
  activitiesTable,
  notesTable,
  usersTable,
  crmFilesTable,
} from "@workspace/db";
import {
  activityQuery,
  escapeLike,
  phoneNsn,
  phoneMatch,
  PHONE_MIN_NSN,
} from "./queries";

// ---------------------------------------------------------------------------
// Global ("Linear-style") search.
//
// Runs one read per CRM entity in parallel, OR-matching each entity's text
// fields with a parameterized ILIKE. For every hit we re-detect
// *which* field matched in JS so the result can show the field name + the
// matching snippet, and we build a deep-link href (with tab / focus params) so
// clicking lands on the exact record / section. Results are grouped by record
// type; each group reports `hasMore` when it was truncated at the per-type cap.
// ---------------------------------------------------------------------------

const PER_TYPE_LIMIT = 6;
// Fetch one row past the cap so `hasMore` costs nothing extra.
const FETCH_LIMIT = PER_TYPE_LIMIT + 1;
const SNIPPET_RADIUS = 48;
// Longest query we honor; anything past this can't be a name/email/phone and
// only inflates the ILIKE scans.
const MAX_TERM_LENGTH = 120;
export type SearchRecordType =
  | "deal"
  | "person"
  | "organization"
  | "activity"
  | "note"
  | "file";

const SEARCH_RECORD_TYPES: SearchRecordType[] = [
  "deal",
  "person",
  "organization",
  "activity",
  "note",
  "file",
];

export interface GlobalSearchItem {
  key: string;
  recordType: SearchRecordType;
  module: string;
  recordId: number;
  title: string;
  field: string;
  matchValue: string;
  relatedName: string | null;
  timestamp: Date | null;
  ownerName: string | null;
  href: string;
}

export interface GlobalSearchGroup {
  module: string;
  recordType: SearchRecordType;
  label: string;
  hasMore: boolean;
  results: GlobalSearchItem[];
}

export interface GlobalSearchResult {
  query: string;
  total: number;
  groups: GlobalSearchGroup[];
}

function parseRequestedTypes(rawTypes?: string | null): SearchRecordType[] {
  if (!rawTypes || rawTypes === "all") return SEARCH_RECORD_TYPES;
  const wanted = new Set<SearchRecordType>();
  for (const token of rawTypes.split(",")) {
    const normalized = token.trim() as SearchRecordType;
    if (SEARCH_RECORD_TYPES.includes(normalized)) wanted.add(normalized);
  }
  return [...wanted];
}

// Collapse whitespace and, for long fields, return a window centred on the
// match so the user sees the relevant part rather than the whole blob.
function snippet(value: string, lowerTerm: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= 100) return text;
  const idx = text.toLowerCase().indexOf(lowerTerm);
  if (idx < 0) return text.slice(0, 100) + "…";
  const start = Math.max(0, idx - SNIPPET_RADIUS);
  const end = Math.min(text.length, idx + lowerTerm.length + SNIPPET_RADIUS);
  return (
    (start > 0 ? "…" : "") +
    text.slice(start, end) +
    (end < text.length ? "…" : "")
  );
}

type Candidate = { label: string; value: string | null | undefined };

// Pick the first candidate field whose value actually contains the term. SQL
// already guaranteed at least one field matched; the JS pass just identifies it
// so we can surface a precise "field + value". Falls back to the first present
// field if a case/locale quirk makes none of them match in JS.
function pickMatch(
  lowerTerm: string,
  candidates: Candidate[],
): { field: string; matchValue: string } {
  for (const c of candidates) {
    if (c.value && c.value.toLowerCase().includes(lowerTerm)) {
      return { field: c.label, matchValue: snippet(c.value, lowerTerm) };
    }
  }
  const first = candidates.find((c) => c.value);
  return {
    field: first?.label ?? candidates[0]?.label ?? "",
    matchValue: first?.value ? snippet(first.value, lowerTerm) : "",
  };
}

function q(value: string): string {
  return encodeURIComponent(value);
}

// True when the raw term hit a person's name or email (so we don't mislabel a
// text match as a phone match when both happen to coincide).
function nameOrEmailHit(
  lowerTerm: string,
  p: { name?: string | null; email?: string | null },
): boolean {
  return (
    (!!p.name && p.name.toLowerCase().includes(lowerTerm)) ||
    (!!p.email && p.email.toLowerCase().includes(lowerTerm))
  );
}

export async function globalSearch(
  rawTerm: string,
  rawTypes?: string | null,
): Promise<GlobalSearchResult> {
  const term = rawTerm.slice(0, MAX_TERM_LENGTH);
  const like = `%${escapeLike(term)}%`;
  const lower = term.toLowerCase();
  // Normalized phone form of the query (empty unless it looks like a number).
  const nsn = phoneNsn(term);
  const personPhone = phoneMatch(personsTable.phone, term);
  const requestedTypes = parseRequestedTypes(rawTypes);

  if (rawTypes && requestedTypes.length === 0) {
    return { query: term, total: 0, groups: [] };
  }

  const wanted = new Set(requestedTypes);
  const includeAll = wanted.size === SEARCH_RECORD_TYPES.length;

  const dealRowsPromise = wanted.has("deal") || includeAll
    ? db
        .select({
          id: dealsTable.id,
          title: dealsTable.title,
          comments: dealsTable.comments,
          utmKeyword: dealsTable.utmKeyword,
          updateTime: dealsTable.updateTime,
          ownerName: usersTable.name,
          organizationName: organizationsTable.name,
          personName: personsTable.name,
        })
        .from(dealsTable)
        .leftJoin(usersTable, eq(dealsTable.ownerId, usersTable.id))
        .leftJoin(
          organizationsTable,
          eq(dealsTable.organizationId, organizationsTable.id),
        )
        .leftJoin(personsTable, eq(dealsTable.personId, personsTable.id))
        .where(
          and(
            ne(dealsTable.status, "deleted"),
            // Archived deals are out of day-to-day circulation.
            eq(dealsTable.archived, false),
            or(
              ilike(dealsTable.title, like),
              ilike(dealsTable.comments, like),
              ilike(dealsTable.utmKeyword, like),
            ),
          ),
        )
        .orderBy(desc(dealsTable.updateTime))
        .limit(FETCH_LIMIT)
    : Promise.resolve([]);

  const personRowsPromise = wanted.has("person") || includeAll
    ? db
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
        .leftJoin(
          organizationsTable,
          eq(personsTable.organizationId, organizationsTable.id),
        )
        .where(
          // Name/email match the raw term; phone matches on the normalized
          // (format-insensitive) form so any valid phone formatting resolves.
          or(
            ilike(personsTable.name, like),
            ilike(personsTable.email, like),
            ...(personPhone ? [personPhone] : []),
          ),
        )
        .orderBy(desc(personsTable.updateTime))
        .limit(FETCH_LIMIT)
    : Promise.resolve([]);

  const orgRowsPromise = wanted.has("organization") || includeAll
    ? db
        .select({
          id: organizationsTable.id,
          name: organizationsTable.name,
          address: organizationsTable.address,
          updateTime: organizationsTable.updateTime,
          ownerName: usersTable.name,
        })
        .from(organizationsTable)
        .leftJoin(usersTable, eq(organizationsTable.ownerId, usersTable.id))
        .where(
          or(
            ilike(organizationsTable.name, like),
            ilike(organizationsTable.address, like),
          ),
        )
        .orderBy(desc(organizationsTable.updateTime))
        .limit(FETCH_LIMIT)
    : Promise.resolve([]);

  const activityRowsPromise = wanted.has("activity") || includeAll
    ? activityQuery()
        .where(
          and(
            eq(activitiesTable.draft, false),
            or(
              ilike(activitiesTable.subject, like),
              ilike(activitiesTable.note, like),
            ),
          ),
        )
        .orderBy(desc(activitiesTable.updateTime))
        .limit(FETCH_LIMIT)
    : Promise.resolve([]);

  const noteRowsPromise = wanted.has("note") || includeAll
    ? db
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
        .leftJoin(
          organizationsTable,
          eq(notesTable.orgId, organizationsTable.id),
        )
        .where(
          and(
            eq(notesTable.activeFlag, true),
            eq(notesTable.draft, false),
            ilike(notesTable.content, like),
          ),
        )
        .orderBy(desc(notesTable.updateTime))
        .limit(FETCH_LIMIT)
    : Promise.resolve([]);

  const fileRowsPromise = wanted.has("file") || includeAll
    ? db
        .select({
          id: crmFilesTable.id,
          fileName: crmFilesTable.fileName,
          noteId: crmFilesTable.noteId,
          dealId: crmFilesTable.dealId,
          updateTime: crmFilesTable.updateTime,
          uploaderName: usersTable.name,
          dealTitle: dealsTable.title,
        })
        .from(crmFilesTable)
        .innerJoin(notesTable, eq(crmFilesTable.noteId, notesTable.id))
        .leftJoin(usersTable, eq(crmFilesTable.uploadedBy, usersTable.id))
        .leftJoin(dealsTable, eq(crmFilesTable.dealId, dealsTable.id))
        .where(
          and(
            eq(notesTable.draft, false),
            eq(notesTable.activeFlag, true),
            ilike(crmFilesTable.fileName, like),
          ),
        )
        .orderBy(desc(crmFilesTable.updateTime))
        .limit(FETCH_LIMIT)
    : Promise.resolve([]);

  const [
    dealRows,
    personRows,
    orgRows,
    activityRows,
    noteRows,
    fileRows,
  ] = await Promise.all([
      // Lean projections: global search only needs the displayed columns, so we
      // skip the list builders' per-row correlated subqueries (deal counts,
      // last-activity / rotting) and unused joins entirely.
      dealRowsPromise,
      personRowsPromise,
      orgRowsPromise,
      activityRowsPromise,
      noteRowsPromise,
      fileRowsPromise,
    ]);

  // Trim the probe row fetched past the cap; its presence is the hasMore signal.
  const cap = <T,>(rows: T[]) => ({
    rows: rows.slice(0, PER_TYPE_LIMIT),
    hasMore: rows.length > PER_TYPE_LIMIT,
  });
  const deals = cap(dealRows);
  const persons = cap(personRows);
  const orgs = cap(orgRows);
  const activities = cap(activityRows);
  const notes = cap(noteRows);
  const files = cap(fileRows);

  const dealItems: GlobalSearchItem[] = deals.rows.map((d) => {
    const m = pickMatch(lower, [
      { label: "Title", value: d.title },
      { label: "Comments", value: d.comments },
      { label: "UTM keyword", value: d.utmKeyword },
    ]);
    return {
      key: `deal-${d.id}-${m.field}`,
      recordType: "deal",
      module: "Deals",
      recordId: d.id,
      title: d.title,
      field: m.field,
      matchValue: m.matchValue,
      relatedName: d.organizationName ?? d.personName ?? null,
      timestamp: d.updateTime ?? null,
      ownerName: d.ownerName ?? null,
      href: `/deal/${d.id}`,
    };
  });

  const personItems: GlobalSearchItem[] = persons.rows.map((p) => {
    // Identify the matched field. Name/email match the raw term; phone is
    // compared on its normalized form (the raw value won't literally contain a
    // reformatted query like "0500001234"). The length gate mirrors phoneMatch:
    // below it SQL never ran a phone predicate, so labeling one would lie.
    const m =
      nsn.length >= PHONE_MIN_NSN &&
      p.phone &&
      phoneNsn(p.phone).includes(nsn) &&
      !nameOrEmailHit(lower, p)
        ? { field: "Phone", matchValue: p.phone ?? "" }
        : pickMatch(lower, [
            { label: "Name", value: p.name },
            { label: "Email", value: p.email },
            { label: "Phone", value: p.phone },
          ]);
    return {
      key: `person-${p.id}-${m.field}`,
      recordType: "person",
      module: "Contacts",
      recordId: p.id,
      title: p.name,
      field: m.field,
      matchValue: m.matchValue,
      relatedName: p.organizationName ?? null,
      timestamp: p.updateTime ?? null,
      ownerName: p.ownerName ?? null,
      href: `/contacts?tab=persons&focus=${p.id}&q=${q(p.name)}`,
    };
  });

  const orgItems: GlobalSearchItem[] = orgs.rows.map((o) => {
    const m = pickMatch(lower, [
      { label: "Name", value: o.name },
      { label: "Address", value: o.address },
    ]);
    return {
      key: `organization-${o.id}-${m.field}`,
      recordType: "organization",
      module: "Contacts",
      recordId: o.id,
      title: o.name,
      field: m.field,
      matchValue: m.matchValue,
      relatedName: null,
      timestamp: o.updateTime ?? null,
      ownerName: o.ownerName ?? null,
      href: `/contacts?tab=organizations&focus=${o.id}&q=${q(o.name)}`,
    };
  });

  const activityItems: GlobalSearchItem[] = activities.rows.map((a) => {
    const m = pickMatch(lower, [
      { label: "Subject", value: a.subject },
      { label: "Note", value: a.note },
    ]);
    return {
      key: `activity-${a.id}-${m.field}`,
      recordType: "activity",
      module: "Activities",
      recordId: a.id,
      title: a.subject,
      field: m.field,
      matchValue: m.matchValue,
      relatedName: a.dealTitle ?? a.personName ?? null,
      timestamp: a.updateTime ?? null,
      ownerName: a.ownerName ?? null,
      href: a.dealId
        ? `/deal/${a.dealId}?focus=activity-${a.id}`
        : `/activities?focus=${a.id}&q=${q(a.subject)}`,
    };
  });

  const noteItems: GlobalSearchItem[] = notes.rows.map((n) => {
    const related = n.dealTitle ?? n.personName ?? n.orgName ?? null;
    const href = n.dealId
      ? `/deal/${n.dealId}?focus=note-${n.id}`
      : n.personId
        ? `/contacts?tab=persons&focus=${n.personId}`
        : n.orgId
          ? `/contacts?tab=organizations&focus=${n.orgId}`
          : `/search?q=${q(term)}`;
    return {
      key: `note-${n.id}-content`,
      recordType: "note",
      module: "Notes",
      recordId: n.id,
      title: related ? `Note on ${related}` : "Note",
      field: "Note",
      matchValue: snippet(n.content, lower),
      relatedName: related,
      timestamp: n.updateTime ?? null,
      ownerName: n.userName ?? null,
      href,
    };
  });

  const fileItems: GlobalSearchItem[] = files.rows.map((f) => {
    const related = f.dealTitle ?? null;
    return {
      key: `file-${f.id}`,
      recordType: "file",
      module: "Attachments",
      recordId: f.id,
      title: f.fileName,
      field: "Attachment",
      matchValue: snippet(f.fileName, lower),
      relatedName: related,
      timestamp: f.updateTime ?? null,
      ownerName: f.uploaderName ?? null,
      // Comment attachments always carry dealId + noteId — deep-link to the
      // parent comment in the timeline (same target as a note result).
      href:
        f.dealId && f.noteId
          ? `/deal/${f.dealId}?focus=note-${f.noteId}`
          : `/search?q=${q(term)}`,
    };
  });

  const groups: GlobalSearchGroup[] = [
    { module: "Deals", recordType: "deal" as const, label: "Deals", hasMore: deals.hasMore, results: dealItems },
    { module: "Contacts", recordType: "person" as const, label: "People", hasMore: persons.hasMore, results: personItems },
    { module: "Contacts", recordType: "organization" as const, label: "Organizations", hasMore: orgs.hasMore, results: orgItems },
    { module: "Activities", recordType: "activity" as const, label: "Activities", hasMore: activities.hasMore, results: activityItems },
    { module: "Notes", recordType: "note" as const, label: "Notes", hasMore: notes.hasMore, results: noteItems },
    { module: "Attachments", recordType: "file" as const, label: "Attachments", hasMore: files.hasMore, results: fileItems },
  ].filter((g) => g.results.length > 0);

  const total = groups.reduce((sum, g) => sum + g.results.length, 0);

  return { query: term, total, groups };
}
