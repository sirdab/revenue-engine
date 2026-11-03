import type { ColumnDef } from "@tanstack/react-table";
import type { Deal } from "@workspace/api-client-react";
import type { Translate } from "@/lib/i18n/i18n";
import {
  extraColumns,
  extraColumnIds,
  type ExtraColumnSpec,
} from "@/components/shared/extra-columns";

// Every native deal field that isn't already one of the primary columns in
// deals-list-view, as read-only, default-hidden columns the column picker can
// offer (Pipedrive-style "add any field"). Grouped by origin so the picker
// reads cleanly. Only fields in the server sort allowlist are sortable.

const SPECS: ExtraColumnSpec[] = [
  // Identity / references
  { id: "id", header: "deals.field.id", kind: "number", size: 90, group: "deals.group.dealFields" },
  { id: "organizationId", header: "deals.field.organizationId", kind: "number", size: 90, group: "deals.group.dealFields" },
  { id: "personName", header: "deals.field.personName", size: 170, group: "deals.group.dealFields" },
  { id: "personId", header: "deals.field.personId", kind: "number", size: 90, group: "deals.group.dealFields" },
  { id: "currency", header: "deals.field.currency", size: 90, group: "deals.group.dealFields" },
  { id: "pipelineId", header: "deals.field.pipelineId", kind: "number", size: 90, group: "deals.group.dealFields" },
  { id: "stageId", header: "deals.field.stageId", kind: "number", size: 90, group: "deals.group.dealFields" },
  { id: "creatorUserId", header: "deals.field.creatorUserId", kind: "number", size: 90, group: "deals.group.dealFields" },
  { id: "lostReason", header: "deals.field.lostReason", size: 220, group: "deals.group.dealFields" },
  { id: "comments", header: "deals.field.comments", size: 240, group: "deals.group.dealFields" },
  { id: "visibleTo", header: "deals.field.visibleTo", size: 120, group: "deals.group.dealFields" },
  { id: "labels", header: "deals.field.labels", kind: "list", size: 200, group: "deals.group.dealFields" },
  { id: "isRotting", header: "deals.field.isRotting", kind: "bool", size: 90, group: "deals.group.dealFields" },
  { id: "archived", header: "deals.field.archived", kind: "bool", size: 90, group: "deals.group.dealFields" },
  // Lifecycle timestamps
  { id: "updateTime", header: "deals.field.updateTime", kind: "datetime", size: 190, group: "deals.group.timestamps" },
  { id: "stageChangeTime", header: "deals.field.stageChangeTime", kind: "datetime", size: 190, sortable: true, group: "deals.group.timestamps" },
  { id: "wonTime", header: "deals.field.wonTime", kind: "datetime", size: 190, sortable: true, group: "deals.group.timestamps" },
  { id: "lostTime", header: "deals.field.lostTime", kind: "datetime", size: 190, group: "deals.group.timestamps" },
  { id: "closeTime", header: "deals.field.closeTime", kind: "datetime", size: 190, group: "deals.group.timestamps" },
  { id: "archiveTime", header: "deals.field.archiveTime", kind: "datetime", size: 190, group: "deals.group.timestamps" },
  // Source / attribution
  { id: "utmSource", header: "deals.field.utmSource", size: 140, group: "deals.group.source" },
  { id: "utmMedium", header: "deals.field.utmMedium", size: 140, group: "deals.group.source" },
  { id: "utmCampaign", header: "deals.field.utmCampaign", size: 160, group: "deals.group.source" },
  { id: "utmKeyword", header: "deals.field.utmKeyword", size: 160, sortable: true, group: "deals.group.source" },
  { id: "adName", header: "deals.field.adName", size: 160, group: "deals.group.source" },
  { id: "gclid", header: "deals.field.gclid", size: 160, group: "deals.group.source" },
  { id: "fbclid", header: "deals.field.fbclid", size: 160, group: "deals.group.source" },
  { id: "wbraid", header: "deals.field.wbraid", size: 160, group: "deals.group.source" },
  { id: "gbraid", header: "deals.field.gbraid", size: 160, group: "deals.group.source" },
];

// Every native deal field maps to a real column the server can sort (see
// SORT_COLUMNS in api-server/src/lib/queries.ts), so default them all sortable —
// except `labels` (a text[] array) and the computed `isRotting` flag, which have
// no meaningful column-level ordering. Keep this denylist in sync with the
// server allowlist so a header never shows a sort arrow that does nothing.
const NON_SORTABLE_IDS = new Set(["labels", "isRotting"]);
const SORTABLE_SPECS: ExtraColumnSpec[] = SPECS.map((s) => ({
  ...s,
  sortable: s.sortable ?? !NON_SORTABLE_IDS.has(s.id),
}));

/** Built inside the component so the headers come out in the active
 *  language. */
export function nativeExtraColumns(t: Translate): ColumnDef<Deal>[] {
  return extraColumns<Deal>(t, SORTABLE_SPECS);
}
export const NATIVE_EXTRA_COLUMN_IDS: string[] = extraColumnIds(SPECS);
