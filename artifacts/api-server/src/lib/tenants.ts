import { eq, sql } from "drizzle-orm";
import {
  db,
  runAsSystem,
  runWithTenant,
  tenantsTable,
  usersTable,
  pipelinesTable,
  stagesTable,
  type Tenant,
} from "@workspace/db";
import { runInWorkspace, signupRegionalSettings } from "./workspace-settings";
import { hashPassword } from "./auth";
import { ensureNativeColumnFields } from "./deal-fields";
import { logger } from "./logger";

// Tenant lifecycle: creating a workspace and visiting every workspace from a
// background job. Request handling never needs this module — a signed-in
// request is already bound to its user's tenant by requireAuth.

// The pipeline every new workspace starts with, so the board is usable on the
// first sign-in, in the language the workspace signed up in. Admins rename,
// reorder or replace it from Settings.
const DEFAULT_PIPELINE = { en: "Sales pipeline", ar: "مسار المبيعات" };
const DEFAULT_STAGES: { en: string; ar: string; probability: number }[] = [
  { en: "Qualified", ar: "مؤهلة", probability: 10 },
  { en: "Contact made", ar: "تم التواصل", probability: 20 },
  { en: "Demo scheduled", ar: "عرض توضيحي مجدول", probability: 40 },
  { en: "Proposal made", ar: "تم إرسال عرض السعر", probability: 60 },
  { en: "Negotiation", ar: "تفاوض", probability: 80 },
];

export class EmailTakenError extends Error {
  constructor() {
    super("An account with this email already exists");
  }
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "workspace"
  );
}

export interface CreateWorkspaceInput {
  workspaceName: string;
  name: string;
  email: string;
  password: string;
  /** The sign-up page's language: "ar" names the pipeline in Arabic. */
  locale?: "en" | "ar";
  /** The browser's IANA zone; an unknown one is ignored. */
  timezone?: string;
}

/**
 * Create a tenant, its first admin and its default pipeline, atomically.
 * Runs in the system scope because the tenant does not exist yet, so every
 * insert names its tenant explicitly.
 */
export async function createWorkspace(
  input: CreateWorkspaceInput,
): Promise<{ tenant: Tenant; userId: number }> {
  const email = input.email.toLowerCase().trim();
  const passwordHash = await hashPassword(input.password);
  const lang = input.locale === "ar" ? "ar" : "en";

  const result = await runAsSystem(() =>
    db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.email, email));
      if (existing) throw new EmailTakenError();

      const base = slugify(input.workspaceName);
      // A random suffix rather than a counter: two sign-ups racing on the same
      // name must not collide on the unique slug.
      const [{ taken }] = await tx
        .select({ taken: sql<boolean>`exists(select 1 from tenants where slug = ${base})` })
        .from(sql`(select 1) as one`);
      const slug = taken
        ? `${base}-${Math.random().toString(36).slice(2, 8)}`
        : base;

      const regional = signupRegionalSettings(input);
      if (regional.timezone) {
        // The browser and Postgres can disagree on a zone; only one Postgres
        // knows may reach a query (see validateRegionalUpdate).
        const known = await tx.execute(
          sql`select 1 from pg_timezone_names where name = ${regional.timezone} limit 1`,
        );
        if (known.rows.length === 0 && regional.timezone !== "UTC") regional.timezone = null;
      }

      const [tenant] = await tx
        .insert(tenantsTable)
        .values({ name: input.workspaceName.trim(), slug, ...regional })
        .returning();

      const [user] = await tx
        .insert(usersTable)
        .values({
          tenantId: tenant.id,
          name: input.name.trim(),
          email,
          passwordHash,
          isAdmin: true,
        })
        .returning({ id: usersTable.id });

      const [pipeline] = await tx
        .insert(pipelinesTable)
        .values({ tenantId: tenant.id, name: DEFAULT_PIPELINE[lang], isDefault: true })
        .returning({ id: pipelinesTable.id });
      await tx.insert(stagesTable).values(
        DEFAULT_STAGES.map((s, i) => ({
          tenantId: tenant.id,
          pipelineId: pipeline.id,
          name: s[lang],
          probability: s.probability,
          orderIndex: i,
        })),
      );

      return { tenant, userId: user.id };
    }),
  );

  await runWithTenant(result.tenant.id, ensureNativeColumnFields);
  return result;
}

export async function getTenant(id: number): Promise<Tenant | null> {
  const [row] = await runAsSystem(() =>
    db.select().from(tenantsTable).where(eq(tenantsTable.id, id)),
  );
  return row ?? null;
}

export async function renameTenant(id: number, name: string): Promise<Tenant> {
  const [row] = await runAsSystem(() =>
    db
      .update(tenantsTable)
      .set({ name: name.trim() })
      .where(eq(tenantsTable.id, id))
      .returning(),
  );
  return row;
}

/**
 * Run `fn` once per tenant, each inside that tenant's scope. One tenant's
 * failure is logged and does not stop the others. For background jobs only.
 */
export async function forEachTenant(
  label: string,
  fn: (tenantId: number) => Promise<void>,
): Promise<void> {
  const tenants = await runAsSystem(() =>
    db.select({ id: tenantsTable.id }).from(tenantsTable),
  );
  for (const { id } of tenants) {
    try {
      await runInWorkspace(id, () => fn(id));
    } catch (err) {
      logger.error({ err, tenantId: id }, `${label} failed for tenant`);
    }
  }
}
