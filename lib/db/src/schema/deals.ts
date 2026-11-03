import {
  pgTable,
  serial,
  text,
  integer,
  bigint,
  boolean,
  doublePrecision,
  timestamp,
  date,
  jsonb,
  pgEnum,
  index,
  check,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { personsTable } from "./persons";
import { organizationsTable } from "./organizations";
import { pipelinesTable } from "./pipelines";
import { stagesTable } from "./stages";
import { tenantIdColumn, tenantPolicy } from "./tenants";

export const dealStatusEnum = pgEnum("deal_status", [
  "open",
  "won",
  "lost",
  "deleted",
]);

export const dealsTable = pgTable("deals", {
  id: serial("id").primaryKey(),
  tenantId: tenantIdColumn(),
  title: text("title").notNull(),
  value: doublePrecision("value").notNull().default(0),
  currency: text("currency").notNull().default("USD"),
  status: dealStatusEnum("status").notNull().default("open"),
  ownerId: integer("owner_id").references(() => usersTable.id),
  creatorUserId: integer("creator_user_id").references(() => usersTable.id),
  personId: integer("person_id").references(() => personsTable.id),
  organizationId: integer("organization_id").references(
    () => organizationsTable.id,
  ),
  pipelineId: integer("pipeline_id")
    .notNull()
    .references(() => pipelinesTable.id),
  stageId: integer("stage_id")
    .notNull()
    .references(() => stagesTable.id),
  visibleTo: text("visible_to"),
  lostReason: text("lost_reason"),
  // Optional free-text elaboration on the lost reason. A structured, queryable
  // field (not a timeline note) — but deliberately NOT a reporting dimension like
  // lostReason: never surfaced in the deals-filter DSL or the lost-reasons
  // managed-list/promotion flow.
  lostReasonNote: text("lost_reason_note"),
  // Archived (Pipedrive-style): hidden from working views and read-only until
  // restored. Orthogonal to status — restoring returns the previous state.
  archived: boolean("archived").notNull().default(false),
  archiveTime: timestamp("archive_time", { withTimezone: true }),
  comments: text("comments"),
  expectedCloseDate: date("expected_close_date", { mode: "string" }),
  // UTM / ad attribution
  utmSource: text("utm_source"),
  utmMedium: text("utm_medium"),
  utmCampaign: text("utm_campaign"),
  utmKeyword: text("utm_keyword"),
  adName: text("ad_name"),
  gclid: text("gclid"),
  fbclid: text("fbclid"),
  // iOS Google Ads click ids — Apple's tracking limits replace gclid with
  // wbraid (web-to-web) / gbraid (app-to-web); stored for ad-conversion
  // attribution.
  wbraid: text("wbraid"),
  gbraid: text("gbraid"),
  // Free-form categorisation tags shown on the deal (Pipedrive-style labels).
  labels: text("labels").array(),
  // Timestamps
  addTime: timestamp("add_time", { withTimezone: true }).notNull().defaultNow(),
  updateTime: timestamp("update_time", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  stageChangeTime: timestamp("stage_change_time", { withTimezone: true }),
  wonTime: timestamp("won_time", { withTimezone: true }),
  lostTime: timestamp("lost_time", { withTimezone: true }),
  closeTime: timestamp("close_time", { withTimezone: true }),
  // Custom field values, keyed by the deal_field registry key.
  customFields: jsonb("custom_fields"),
  // Idempotency key for externally-created deals (e.g. the n8n lead webhook).
  // Unique when set; multiple NULLs allowed for app/Pipedrive-sourced deals.
  externalId: text("external_id"),
  // Set when this deal was merged into another: the deal is
  // archived and this points at the survivor, so nothing dead-ends.
  mergedIntoDealId: integer("merged_into_deal_id"),
}, (table) => [
    tenantPolicy(),
  uniqueIndex("deals_external_id_uq").on(table.tenantId, table.externalId),
  index("deals_status_idx").on(table.status),
  index("deals_pipeline_idx").on(table.pipelineId),
  index("deals_stage_idx").on(table.stageId),
  index("deals_owner_idx").on(table.ownerId),
  index("deals_org_idx").on(table.organizationId),
  index("deals_person_idx").on(table.personId),
  index("deals_add_time_idx").on(table.addTime),
  // The deals grid's default sort (buildDealOrderBy) is update_time desc;
  // organizations/persons already index update_time, deals was the gap.
  index("deals_update_idx").on(table.updateTime),
  index("deals_won_time_idx").on(table.wonTime),
  index("deals_value_idx").on(table.value),
  index("deals_expected_close_idx").on(table.expectedCloseDate),
  // Expression index for the hottest registry custom-field filter: the
  // Insights board's qualification quick-chip compiles to
  // (custom_fields ->> 'qualification') = $1 on every widget of a filtered
  // board. GIN/jsonb_path_ops cannot serve `->>` text predicates — it must
  // be a btree over the extracted key. Add siblings as other cf: keys get hot.
  index("deals_cf_qualification_idx").using(
    "btree",
    sql`(${table.customFields} ->> 'qualification')`,
  ),
  // A merged deal is ALWAYS archived — the merge sets both in one statement,
  // so the two columns are really one state and must not drift. They did:
  // restoring a merged deal cleared `archived` and left the pointer, and the
  // deal came back into the pipeline looking completely live while every
  // future merge on it failed, in either direction, with no code path able to
  // clear it. Enforcing the pair here makes that state unwritable regardless
  // of which writer is careless — the PATCH, a bulk action, an import, or
  // someone in psql.
  check(
    "deals_merged_implies_archived_chk",
    sql`${table.mergedIntoDealId} is null or ${table.archived} = true`,
  ),
]);

export const insertDealSchema = createInsertSchema(dealsTable).omit({
  id: true,
  addTime: true,
  updateTime: true,
});
export type InsertDeal = z.infer<typeof insertDealSchema>;
export type Deal = typeof dealsTable.$inferSelect;
