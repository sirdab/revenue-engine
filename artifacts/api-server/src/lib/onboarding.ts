import { and, eq, inArray, ne, notInArray, sql, type Column } from "drizzle-orm";
import {
  db,
  activitiesTable,
  appSettingsTable,
  dealsTable,
  notesTable,
  organizationsTable,
  personsTable,
  pipelinesTable,
  stagesTable,
  usersTable,
} from "@workspace/db";
import { clearSetting, getSetting, setSetting } from "./app-settings";
import { appDateInDays } from "./assistant-dates";
import { logDealChanges } from "./change-events";
import { currencyForNewAmount, currentRegionalSettings } from "./regional-context";
import { getTenant } from "./tenants";

// The getting-started checklist on Home (admins only) and the optional sample
// records behind its "Load sample data" button. Every step is derived from
// the workspace's own data, so it ticks itself off however the admin gets
// there; only "dismissed" and the sample record ids are stored (app_settings).

const DISMISSED_KEY = "onboarding_dismissed";
const SAMPLE_KEY = "onboarding_sample_data";

export type OnboardingStepKey = "region" | "contacts" | "team" | "deal";

export interface OnboardingStatus {
  steps: { key: OnboardingStepKey; done: boolean }[];
  dismissed: boolean;
  sampleData: boolean;
}

interface SampleIds {
  organizationIds: number[];
  personIds: number[];
  dealIds: number[];
  activityIds: number[];
}

export class SampleDataError extends Error {}

type Executor = Pick<typeof db, "select">;

async function readSampleIds(exec: Executor = db): Promise<SampleIds | null> {
  const [row] = await exec
    .select({ value: appSettingsTable.value })
    .from(appSettingsTable)
    .where(eq(appSettingsTable.key, SAMPLE_KEY));
  const raw = row?.value;
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<SampleIds>;
    const ids = (a: unknown) => (Array.isArray(a) ? a.filter((n): n is number => Number.isInteger(n)) : []);
    return {
      organizationIds: ids(v.organizationIds),
      personIds: ids(v.personIds),
      dealIds: ids(v.dealIds),
      activityIds: ids(v.activityIds),
    };
  } catch {
    return null;
  }
}

/** `id not in (…)`, or no condition at all for an empty list. */
function notSample(col: Column, ids: number[]) {
  return ids.length > 0 ? notInArray(col, ids) : undefined;
}

export async function getOnboardingStatus(tenantId: number): Promise<OnboardingStatus> {
  const [tenant, sample, dismissed] = await Promise.all([
    getTenant(tenantId),
    readSampleIds(),
    getSetting(DISMISSED_KEY),
  ]);
  const [[contacts], [team], [deals]] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(personsTable)
      .where(notSample(personsTable.id, sample?.personIds ?? [])),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(usersTable)
      .where(eq(usersTable.activeFlag, true)),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(dealsTable)
      .where(and(ne(dealsTable.status, "deleted"), notSample(dealsTable.id, sample?.dealIds ?? []))),
  ]);
  return {
    steps: [
      { key: "region", done: tenant?.timezone != null },
      { key: "contacts", done: contacts.n > 0 },
      { key: "team", done: team.n > 1 },
      { key: "deal", done: deals.n > 0 },
    ],
    dismissed: dismissed === "1",
    sampleData: sample != null,
  };
}

export async function setOnboardingDismissed(dismissed: boolean): Promise<void> {
  if (dismissed) await setSetting(DISMISSED_KEY, "1");
  else await clearSetting(DISMISSED_KEY);
}

// ---- Sample data -----------------------------------------------------------

// Fictional companies and people, marked as samples in their names. Emails
// use example.com (reserved, never delivered) and there are no phone numbers,
// so nothing can ever reach a real person.
const SAMPLE = {
  en: {
    suffix: " (Sample)",
    orgs: ["Al Noor Trading", "Desert Peak Logistics", "Blue Wave Clinics"],
    people: [
      { name: "Sara Al-Harbi", job: "Procurement Manager", email: "sara" },
      { name: "Khalid Al-Otaibi", job: "Operations Director", email: "khalid" },
      { name: "Lina Haddad", job: "Clinic Manager", email: "lina" },
    ],
    deals: ["Annual supply contract", "Warehouse expansion", "Fleet tracking", "Clinic software rollout", "Pilot order"],
    activities: ["Intro call", "Send the proposal", "On-site demo", "Follow up on the quote"],
  },
  ar: {
    suffix: " (مثال)",
    orgs: ["النور للتجارة", "قمة الصحراء للخدمات اللوجستية", "عيادات الموجة الزرقاء"],
    people: [
      { name: "سارة الحربي", job: "مديرة المشتريات", email: "sara" },
      { name: "خالد العتيبي", job: "مدير العمليات", email: "khalid" },
      { name: "لينا حداد", job: "مديرة العيادة", email: "lina" },
    ],
    deals: ["عقد توريد سنوي", "توسعة المستودع", "تتبع الأسطول", "إطلاق نظام العيادات", "طلب تجريبي"],
    activities: ["مكالمة تعريفية", "إرسال عرض السعر", "عرض توضيحي في الموقع", "متابعة عرض السعر"],
  },
} as const;

// [org index, value, stage index (clamped to the pipeline's stages)]
const SAMPLE_DEALS: [number, number, number][] = [
  [0, 45000, 0],
  [1, 120000, 2],
  [1, 18000, 1],
  [2, 32000, 3],
  [0, 9500, 4],
];
// [deal index, type, due in days]
const SAMPLE_ACTIVITIES: [number, "call" | "email" | "meeting" | "task", number][] = [
  [0, "call", 0],
  [3, "email", 1],
  [1, "meeting", 3],
  [2, "task", -1],
];

/** Serialises loads and removals per workspace (two quick clicks, two tabs). */
async function lockSampleData(tx: Pick<typeof db, "execute">): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext('onboarding_sample_data'), nullif(current_setting('app.tenant_id', true), '')::int)`,
  );
}

/**
 * Loads three organizations, their contacts, five open deals on the default
 * pipeline and four activities, owned by `userId`. Written straight to the
 * tables, so no automation, assignment rule, Slack post or webhook fires for
 * them. The ids are kept so removeSampleData deletes exactly these records.
 */
export async function loadSampleData(userId: number, locale?: "en" | "ar"): Promise<void> {
  const lang = locale ?? (currentRegionalSettings().defaultLocale === "ar" ? "ar" : "en");
  const copy = SAMPLE[lang];
  const currency = currencyForNewAmount(null);

  await db.transaction(async (tx) => {
    // Serialise concurrent clicks: the second waits, then sees the first's ids.
    await lockSampleData(tx);
    if (await readSampleIds(tx)) throw new SampleDataError("Sample data is already loaded.");

    const pipelines = await tx
      .select({ id: pipelinesTable.id, isDefault: pipelinesTable.isDefault })
      .from(pipelinesTable)
      .orderBy(pipelinesTable.id);
    const pipeline = pipelines.find((p) => p.isDefault) ?? pipelines[0];
    const stages = pipeline
      ? await tx
          .select({ id: stagesTable.id })
          .from(stagesTable)
          .where(eq(stagesTable.pipelineId, pipeline.id))
          .orderBy(stagesTable.orderIndex)
      : [];
    if (!pipeline || stages.length === 0) {
      throw new SampleDataError("Add a pipeline with at least one stage first.");
    }

    const orgs = await tx
      .insert(organizationsTable)
      .values(copy.orgs.map((name) => ({ name: name + copy.suffix, ownerId: userId })))
      .returning({ id: organizationsTable.id });
    const persons = await tx
      .insert(personsTable)
      .values(
        copy.people.map((p, i) => ({
          name: p.name + copy.suffix,
          jobTitle: p.job,
          email: `${p.email}@example.com`,
          organizationId: orgs[i].id,
          ownerId: userId,
        })),
      )
      .returning({ id: personsTable.id });
    const deals = await tx
      .insert(dealsTable)
      .values(
        SAMPLE_DEALS.map(([org, value, stage], i) => ({
          title: copy.deals[i] + copy.suffix,
          value,
          currency,
          pipelineId: pipeline.id,
          stageId: stages[Math.min(stage, stages.length - 1)].id,
          ownerId: userId,
          creatorUserId: userId,
          personId: persons[org].id,
          organizationId: orgs[org].id,
          expectedCloseDate: appDateInDays(14 + i * 9),
        })),
      )
      .returning({ id: dealsTable.id, personId: dealsTable.personId, organizationId: dealsTable.organizationId });
    const activities = await tx
      .insert(activitiesTable)
      .values(
        SAMPLE_ACTIVITIES.map(([deal, type, days], i) => ({
          subject: copy.activities[i],
          type,
          dueDate: appDateInDays(days),
          dealId: deals[deal].id,
          personId: deals[deal].personId,
          orgId: deals[deal].organizationId,
          ownerId: userId,
          creatorUserId: userId,
        })),
      )
      .returning({ id: activitiesTable.id });

    const ids: SampleIds = {
      organizationIds: orgs.map((o) => o.id),
      personIds: persons.map((p) => p.id),
      dealIds: deals.map((d) => d.id),
      activityIds: activities.map((a) => a.id),
    };
    await tx
      .insert(appSettingsTable)
      .values({ key: SAMPLE_KEY, value: JSON.stringify(ids) });
  });
}

/**
 * Removes the sample records, including anything they were edited into:
 * the deals are deleted the way the app deletes a deal (status "deleted",
 * logged in their history, attachments kept), the sample activities are
 * removed, and the sample people and organizations are deleted after
 * unlinking whatever the team attached to them, as their own delete does.
 */
export async function removeSampleData(userId: number): Promise<void> {
  await db.transaction(async (tx) => {
    await lockSampleData(tx);
    const ids = await readSampleIds(tx);
    if (!ids) return;

    if (ids.activityIds.length) {
      await tx.delete(activitiesTable).where(inArray(activitiesTable.id, ids.activityIds));
    }
    if (ids.dealIds.length) {
      const live = await tx
        .select()
        .from(dealsTable)
        .where(and(inArray(dealsTable.id, ids.dealIds), ne(dealsTable.status, "deleted")))
        .for("update");
      if (live.length) {
        await tx
          .update(dealsTable)
          .set({ status: "deleted" })
          .where(inArray(dealsTable.id, live.map((d) => d.id)));
        await logDealChanges(
          tx,
          live.map((before) => ({ before, patch: { status: "deleted" as const } })),
          { changedBy: userId },
        );
      }
    }
    if (ids.personIds.length) {
      await tx.update(dealsTable).set({ personId: null }).where(inArray(dealsTable.personId, ids.personIds));
      await tx.update(activitiesTable).set({ personId: null }).where(inArray(activitiesTable.personId, ids.personIds));
      await tx.update(notesTable).set({ personId: null }).where(inArray(notesTable.personId, ids.personIds));
      await tx.delete(personsTable).where(inArray(personsTable.id, ids.personIds));
    }
    if (ids.organizationIds.length) {
      const orgIds = ids.organizationIds;
      await tx.update(personsTable).set({ organizationId: null }).where(inArray(personsTable.organizationId, orgIds));
      await tx.update(dealsTable).set({ organizationId: null }).where(inArray(dealsTable.organizationId, orgIds));
      await tx.update(activitiesTable).set({ orgId: null }).where(inArray(activitiesTable.orgId, orgIds));
      await tx.update(notesTable).set({ orgId: null }).where(inArray(notesTable.orgId, orgIds));
      await tx.delete(organizationsTable).where(inArray(organizationsTable.id, orgIds));
    }
    await tx.delete(appSettingsTable).where(eq(appSettingsTable.key, SAMPLE_KEY));
  });
}
