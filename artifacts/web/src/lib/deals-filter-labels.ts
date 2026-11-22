// Translated names for the deals filter DSL.
//
// `@workspace/deals-filter` is shared with the server and carries English
// `label`/`group` strings for its fields and operators. Those stay as they
// are (the server compiles filters, it never shows them), and the client
// maps each field name to a message key here. A field with no entry falls
// back to the DSL's English label, so adding a field to the DSL without a
// key degrades to English rather than to a raw key.

import type {
  FilterFieldDef,
  FilterOperator,
} from "@workspace/deals-filter";
import type { MessageKey, Translate } from "@/lib/i18n/i18n";

const FIELD_KEYS: Partial<Record<string, MessageKey>> = {
  title: "common.title",
  organization: "common.organization",
  value: "common.value",
  pipeline: "common.pipeline",
  stage: "common.stage",
  owner: "common.owner",
  createdDate: "deals.field.createdDate",
  wonTime: "deals.field.wonTime",
  status: "common.status",
  utmKeyword: "deals.field.utmKeyword",
  lostReason: "deals.field.lostReason",
  id: "deals.field.id",
  organizationId: "deals.field.organizationId",
  person: "common.person",
  personId: "deals.field.personId",
  creatorId: "deals.field.creatorUserId",
  currency: "common.currency",
  visibleTo: "deals.field.visibleTo",
  comments: "common.comments",
  labels: "deals.field.labels",
  isRotting: "deals.field.isRotting",
  archived: "deals.field.archived",
  expectedCloseDate: "deals.expectedClose",
  updateTime: "deals.field.updateTime",
  stageChangeTime: "deals.field.stageChangeTime",
  lostTime: "deals.field.lostTime",
  closeTime: "deals.field.closeTime",
  archiveTime: "deals.field.archiveTime",
  lastActivity: "deals.field.lastActivity",
  utmSource: "deals.field.utmSource",
  utmMedium: "deals.field.utmMedium",
  utmCampaign: "deals.field.utmCampaign",
  adName: "deals.field.adName",
  gclid: "deals.field.gclid",
  fbclid: "deals.field.fbclid",
  wbraid: "deals.field.wbraid",
  gbraid: "deals.field.gbraid",
};

const GROUP_KEYS: Partial<Record<string, MessageKey>> = {
  "Deal fields": "deals.group.dealFields",
  Timestamps: "deals.group.timestamps",
  "Source & attribution": "deals.group.source",
};

const OPERATOR_KEYS: Record<FilterOperator, MessageKey> = {
  is: "filter.op.is",
  is_not: "filter.op.isNot",
  contains: "filter.op.contains",
  not_contains: "filter.op.notContains",
  gt: "filter.op.gt",
  lt: "filter.op.lt",
  between: "filter.op.between",
  is_empty: "filter.op.isEmpty",
  is_not_empty: "filter.op.isNotEmpty",
};

export function filterFieldLabel(
  t: Translate,
  f: Pick<FilterFieldDef, "field" | "label">,
): string {
  const key = FIELD_KEYS[f.field];
  return key ? t(key) : f.label;
}

export function filterGroupLabel(t: Translate, group: string): string {
  const key = GROUP_KEYS[group];
  return key ? t(key) : group;
}

export function filterOperatorLabel(t: Translate, op: FilterOperator): string {
  return t(OPERATOR_KEYS[op]);
}

const STATUS_KEYS: Record<string, MessageKey> = {
  open: "deals.status.open",
  won: "deals.status.won",
  lost: "deals.status.lost",
};

/** A deal status (open / won / lost) in the reader's language. */
export function statusLabel(t: Translate, status: string): string {
  const key = STATUS_KEYS[status];
  return key ? t(key) : status;
}
