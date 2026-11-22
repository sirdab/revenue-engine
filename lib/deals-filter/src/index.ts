import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared filter DSL for the Deals workspace.
//
// This package is the single source of truth used by BOTH the API server (to
// validate and compile filters into parameterized SQL) and the web app (to
// render the condition builder and encode the filter into the URL). Keeping it
// shared prevents the client and server from drifting on field names,
// operators, or the URL encoding.
// ---------------------------------------------------------------------------

export const FILTER_OPERATORS = [
  "is",
  "is_not",
  "contains",
  "not_contains",
  "gt",
  "lt",
  "between",
  "is_empty",
  "is_not_empty",
] as const;
export type FilterOperator = (typeof FILTER_OPERATORS)[number];

export const FILTER_FIELD_NAMES = [
  "title",
  "organization",
  "value",
  "pipeline",
  "stage",
  "owner",
  "createdDate",
  "wonTime",
  "status",
  "utmKeyword",
  "lostReason",
  // List-only fields (see `listOnly` below) — every remaining column the deals
  // list can show, so the filter card covers the same vocabulary as the column
  // picker.
  "id",
  "organizationId",
  "person",
  "personId",
  "creatorId",
  "currency",
  "visibleTo",
  "comments",
  "labels",
  "isRotting",
  "archived",
  "expectedCloseDate",
  "updateTime",
  "stageChangeTime",
  "lostTime",
  "closeTime",
  "archiveTime",
  "lastActivity",
  "utmSource",
  "utmMedium",
  "utmCampaign",
  "adName",
  "gclid",
  "fbclid",
  "wbraid",
  "gbraid",
] as const;
export type FilterFieldName = (typeof FILTER_FIELD_NAMES)[number];

export type FilterFieldType =
  | "text"
  | "number"
  | "date"
  | "bool"
  | "pipeline"
  | "stage"
  | "owner"
  | "status"
  | "lostReason";

export interface FilterFieldDef {
  field: FilterFieldName;
  label: string;
  type: FilterFieldType;
  operators: FilterOperator[];
  /** Picker section — mirrors the column picker's grouping. */
  group?: string;
  /**
   * Only usable in the deals LIST filter (SQL compiler). The in-memory
   * evaluator behind assignment rules / automations resolves a fixed set of
   * DealFacts and cannot see joined or computed columns, so these fields are
   * hidden from the rule wizards and rejected at rule write time.
   */
  listOnly?: boolean;
}

const TEXT_OPS: FilterOperator[] = [
  "is",
  "is_not",
  "contains",
  "not_contains",
  "is_empty",
  "is_not_empty",
];
const NUMBER_OPS: FilterOperator[] = [
  "is",
  "is_not",
  "gt",
  "lt",
  "between",
  "is_empty",
  "is_not_empty",
];
const DATE_OPS: FilterOperator[] = [
  "is",
  "is_not",
  "gt",
  "lt",
  "between",
  "is_empty",
  "is_not_empty",
];
const SELECT_OPS: FilterOperator[] = ["is", "is_not", "is_empty", "is_not_empty"];
const ENUM_OPS: FilterOperator[] = ["is", "is_not"];
const BOOL_OPS: FilterOperator[] = ["is"];

// Group labels — kept aligned with the column picker (deal-native-columns).
const G_DEAL = "Deal fields";
const G_TIME = "Timestamps";
const G_SRC = "Source & attribution";

export const FILTER_FIELDS: FilterFieldDef[] = [
  { field: "title", label: "Title", type: "text", operators: TEXT_OPS },
  {
    field: "organization",
    label: "Organization",
    type: "text",
    operators: TEXT_OPS,
  },
  { field: "value", label: "Value", type: "number", operators: NUMBER_OPS },
  { field: "pipeline", label: "Pipeline", type: "pipeline", operators: SELECT_OPS },
  { field: "stage", label: "Stage", type: "stage", operators: SELECT_OPS },
  { field: "owner", label: "Owner", type: "owner", operators: SELECT_OPS },
  {
    field: "createdDate",
    label: "Deal created",
    type: "date",
    operators: DATE_OPS,
  },
  { field: "wonTime", label: "Won time", type: "date", operators: DATE_OPS },
  { field: "status", label: "Status", type: "status", operators: ENUM_OPS },
  {
    field: "utmKeyword",
    label: "UTM keyword",
    type: "text",
    operators: TEXT_OPS,
  },
  {
    // deals.lost_reason is plain text: values are managed lost-reason names,
    // but historical free-text one-offs exist too, so the picker offers both.
    // is_empty doubles as "lost with no reason recorded".
    field: "lostReason",
    label: "Lost reason",
    type: "lostReason",
    operators: ["is", "is_not", "is_empty", "is_not_empty"],
  },

  // -- List-only fields (everything else the column picker offers) ----------
  // Identity / references
  { field: "id", label: "Deal ID", type: "number", operators: NUMBER_OPS, group: G_DEAL, listOnly: true },
  { field: "organizationId", label: "Org ID", type: "number", operators: NUMBER_OPS, group: G_DEAL, listOnly: true },
  { field: "person", label: "Person", type: "text", operators: TEXT_OPS, group: G_DEAL, listOnly: true },
  { field: "personId", label: "Person ID", type: "number", operators: NUMBER_OPS, group: G_DEAL, listOnly: true },
  // The creator can be any user (incl. inactive/admin users who own no deals),
  // so the owner picker can't list them all — expose it as the numeric id the
  // column picker already shows ("Creator ID"), consistent with Org/Person ID.
  { field: "creatorId", label: "Creator ID", type: "number", operators: NUMBER_OPS, group: G_DEAL, listOnly: true },
  { field: "currency", label: "Currency", type: "text", operators: TEXT_OPS, group: G_DEAL, listOnly: true },
  { field: "visibleTo", label: "Visible to", type: "text", operators: TEXT_OPS, group: G_DEAL, listOnly: true },
  { field: "comments", label: "Comments", type: "text", operators: TEXT_OPS, group: G_DEAL, listOnly: true },
  {
    // text[]: `is` = has exactly this label, `contains` = any label matches
    // the substring, is_empty = no labels at all.
    field: "labels",
    label: "Labels",
    type: "text",
    operators: TEXT_OPS,
    group: G_DEAL,
    listOnly: true,
  },
  { field: "isRotting", label: "Rotting", type: "bool", operators: BOOL_OPS, group: G_DEAL, listOnly: true },
  { field: "archived", label: "Archived", type: "bool", operators: BOOL_OPS, group: G_DEAL, listOnly: true },
  // Lifecycle timestamps
  { field: "expectedCloseDate", label: "Expected close", type: "date", operators: DATE_OPS, group: G_TIME, listOnly: true },
  { field: "updateTime", label: "Updated", type: "date", operators: DATE_OPS, group: G_TIME, listOnly: true },
  { field: "stageChangeTime", label: "Stage changed", type: "date", operators: DATE_OPS, group: G_TIME, listOnly: true },
  { field: "lostTime", label: "Lost at", type: "date", operators: DATE_OPS, group: G_TIME, listOnly: true },
  { field: "closeTime", label: "Closed at", type: "date", operators: DATE_OPS, group: G_TIME, listOnly: true },
  { field: "archiveTime", label: "Archived at", type: "date", operators: DATE_OPS, group: G_TIME, listOnly: true },
  { field: "lastActivity", label: "Last activity", type: "date", operators: DATE_OPS, group: G_TIME, listOnly: true },
  // Source / attribution
  { field: "utmSource", label: "UTM source", type: "text", operators: TEXT_OPS, group: G_SRC, listOnly: true },
  { field: "utmMedium", label: "UTM medium", type: "text", operators: TEXT_OPS, group: G_SRC, listOnly: true },
  { field: "utmCampaign", label: "UTM campaign", type: "text", operators: TEXT_OPS, group: G_SRC, listOnly: true },
  { field: "adName", label: "Ad name", type: "text", operators: TEXT_OPS, group: G_SRC, listOnly: true },
  { field: "gclid", label: "gclid", type: "text", operators: TEXT_OPS, group: G_SRC, listOnly: true },
  { field: "fbclid", label: "fbclid", type: "text", operators: TEXT_OPS, group: G_SRC, listOnly: true },
  { field: "wbraid", label: "wbraid", type: "text", operators: TEXT_OPS, group: G_SRC, listOnly: true },
  { field: "gbraid", label: "gbraid", type: "text", operators: TEXT_OPS, group: G_SRC, listOnly: true },
];

/** The subset the assignment-rule / automation wizards may use — fields the
 *  in-memory evaluator can resolve from DealFacts. */
export const RULE_FILTER_FIELDS: FilterFieldDef[] = FILTER_FIELDS.filter(
  (f) => !f.listOnly,
);

export const FILTER_FIELD_MAP: Record<FilterFieldName, FilterFieldDef> =
  Object.fromEntries(FILTER_FIELDS.map((f) => [f.field, f])) as Record<
    FilterFieldName,
    FilterFieldDef
  >;

export const OPERATOR_LABELS: Record<FilterOperator, string> = {
  is: "is",
  is_not: "is not",
  contains: "contains",
  not_contains: "does not contain",
  gt: "is greater than",
  lt: "is less than",
  between: "is between",
  is_empty: "is empty",
  is_not_empty: "is not empty",
};

const scalarValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const filterValue = z.union([scalarValue, z.array(scalarValue)]).optional();

export const filterConditionSchema = z.object({
  field: z.enum(FILTER_FIELD_NAMES),
  operator: z.enum(FILTER_OPERATORS),
  value: filterValue,
});
export type FilterCondition = z.infer<typeof filterConditionSchema>;

export type FilterNode = FilterCondition | FilterGroup;
export interface FilterGroup {
  combinator: "and" | "or";
  conditions: FilterNode[];
}

export const filterGroupSchema: z.ZodType<FilterGroup> = z.lazy(() =>
  z.object({
    combinator: z.enum(["and", "or"]),
    conditions: z
      .array(z.union([filterConditionSchema, filterGroupSchema]))
      .max(200),
  }),
);

export function isFilterGroup(node: FilterNode): node is FilterGroup {
  return (node as FilterGroup).combinator !== undefined;
}

// ---------------------------------------------------------------------------
// Extended DSL: custom-field conditions (Insights).
//
// The base schema above stays closed over the 11 native fields — it is what
// the deals list, saved views, and assignment rules validate against. The
// extended schema additionally admits `cf:<key>` fields, where <key> is a
// deal_field registry key. Compilation of cf: conditions is registry-driven
// and server-side only (the key is resolved against the allow-list, never
// interpolated); the base compiler keeps rejecting them. `cf:` matches the
// namespace change_events already uses for custom-field audit rows.
// ---------------------------------------------------------------------------

export const CUSTOM_FIELD_PREFIX = "cf:";

export function isCustomFieldRef(field: string): boolean {
  return field.startsWith(CUSTOM_FIELD_PREFIX);
}

/** `cf:contract_term` -> `contract_term` */
export function customFieldKey(field: string): string {
  return field.slice(CUSTOM_FIELD_PREFIX.length);
}

// Structurally: a cf:<key> registry ref or any identifier-shaped field name.
// The per-scope allow-list (server-side, at compile time) is the real gate —
// this schema only rejects garbage, it does not enumerate fields, so scopes
// with their own vocabularies (Insights) can reuse it.
const extendedFieldSchema = z.union([
  z
    .string()
    .regex(/^cf:[a-z0-9_]{1,120}$/, "custom field ref must be cf:<snake_case_key>"),
  z
    .string()
    .regex(/^[a-zA-Z][a-zA-Z0-9_]{0,119}$/, "field must be an identifier"),
]);

export const extendedFilterConditionSchema = z.object({
  field: extendedFieldSchema,
  operator: z.enum(FILTER_OPERATORS),
  value: filterValue,
});
export type ExtendedFilterCondition = z.infer<typeof extendedFilterConditionSchema>;

export type ExtendedFilterNode = ExtendedFilterCondition | ExtendedFilterGroup;
export interface ExtendedFilterGroup {
  combinator: "and" | "or";
  conditions: ExtendedFilterNode[];
}

export const extendedFilterGroupSchema: z.ZodType<ExtendedFilterGroup> = z.lazy(
  () =>
    z.object({
      combinator: z.enum(["and", "or"]),
      conditions: z
        .array(z.union([extendedFilterConditionSchema, extendedFilterGroupSchema]))
        .max(200),
    }),
);

export const EMPTY_EXTENDED_FILTER: ExtendedFilterGroup = {
  combinator: "and",
  conditions: [],
};

/** Decode and validate against the extended (cf:-aware) schema. */
export function decodeExtendedFilters(encoded: string): ExtendedFilterGroup {
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const json = new TextDecoder().decode(bytes);
  const parsed: unknown = JSON.parse(json);
  return extendedFilterGroupSchema.parse(parsed);
}

export const EMPTY_FILTER: FilterGroup = { combinator: "and", conditions: [] };

/** Operators that do not carry a value (presence checks). */
export function operatorTakesValue(op: FilterOperator): boolean {
  return op !== "is_empty" && op !== "is_not_empty";
}

/** True when any condition in the tree filters on `field`. Used by the API
 *  to relax defaults that would contradict an explicit filter (e.g. the
 *  deals list's open-only default vs a "Status is lost" condition). */
export function groupReferencesField(
  group: FilterGroup,
  field: FilterFieldName,
): boolean {
  for (const node of group.conditions) {
    if (isFilterGroup(node)) {
      if (groupReferencesField(node, field)) return true;
    } else if (node.field === field) {
      return true;
    }
  }
  return false;
}

export function countConditions(group: FilterGroup): number {
  let n = 0;
  for (const node of group.conditions) {
    n += isFilterGroup(node) ? countConditions(node) : 1;
  }
  return n;
}

export function maxDepth(group: FilterGroup, current = 1): number {
  let max = current;
  for (const node of group.conditions) {
    if (isFilterGroup(node)) max = Math.max(max, maxDepth(node, current + 1));
  }
  return max;
}

// ---------------------------------------------------------------------------
// Isomorphic base64url encoding (works in Node 16+ and browsers). The filter is
// carried in the URL so any view is bookmarkable/shareable. base64url avoids
// escaping issues with raw JSON in query strings.
// ---------------------------------------------------------------------------

export function encodeFilters(group: FilterGroup | ExtendedFilterGroup): string {
  const json = JSON.stringify(group);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Decode and validate. Throws (ZodError/SyntaxError) on malformed input. */
export function decodeFilters(encoded: string): FilterGroup {
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const json = new TextDecoder().decode(bytes);
  const parsed: unknown = JSON.parse(json);
  return filterGroupSchema.parse(parsed);
}

// In-memory condition evaluator (rule matching) — the runtime counterpart to
// the SQL compiler in the api-server. See evaluate.ts.
export {
  evaluate,
  type EvaluateOptions,
  type DealFacts,
} from "./evaluate";
