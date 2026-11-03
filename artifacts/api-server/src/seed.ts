import { eq } from "drizzle-orm";
import {
  db,
  pool,
  runAsSystem,
  runWithTenant,
  tenantsTable,
  usersTable,
  pipelinesTable,
  stagesTable,
  organizationsTable,
  personsTable,
  dealsTable,
  activitiesTable,
  notesTable,
  linkPreviewsTable,
} from "@workspace/db";
import { hashPassword } from "./lib/auth";
import { createWorkspace } from "./lib/tenants";
import { logger } from "./lib/logger";

// Demo data: two workspaces with the same shape, so tenant isolation can be
// seen working (sign in as either admin and only that workspace's records
// appear). DESTRUCTIVE: deletes every tenant, and with it every row.

const DEMO_PASSWORD = "demo2026";

interface DemoWorkspace {
  name: string;
  domain: string;
  admin: string;
  reps: [string, string];
  orgs: { name: string; address: string }[];
}

const WORKSPACES: DemoWorkspace[] = [
  {
    name: "Acme Demo",
    domain: "acme.test",
    admin: "Avery Admin",
    reps: ["Jordan Lee", "Sam Patel"],
    orgs: [
      { name: "Northwind Traders", address: "Seattle, WA" },
      { name: "Contoso Ltd", address: "Austin, TX" },
      { name: "Fabrikam Inc", address: "Denver, CO" },
    ],
  },
  {
    name: "Globex Demo",
    domain: "globex.test",
    admin: "Morgan Admin",
    reps: ["Riley Chen", "Casey Diaz"],
    orgs: [
      { name: "Initech", address: "London, UK" },
      { name: "Umbrella Corp", address: "Berlin, DE" },
      { name: "Stark Industries", address: "Toronto, CA" },
    ],
  },
];

function daysFromNow(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

function dateString(days: number): string {
  return daysFromNow(days).toISOString().slice(0, 10);
}

async function seedWorkspace(w: DemoWorkspace): Promise<void> {
  const { tenant, userId: adminId } = await createWorkspace({
    workspaceName: w.name,
    name: w.admin,
    email: `admin@${w.domain}`,
    password: DEMO_PASSWORD,
  });

  await runWithTenant(tenant.id, async () => {
    const passwordHash = await hashPassword(DEMO_PASSWORD);
    const reps = await db
      .insert(usersTable)
      .values(
        w.reps.map((name) => ({
          name,
          email: `${name.split(" ")[0].toLowerCase()}@${w.domain}`,
          passwordHash,
        })),
      )
      .returning();
    const owners = [adminId, ...reps.map((r) => r.id)];

    const [pipeline] = await db
      .select()
      .from(pipelinesTable)
      .where(eq(pipelinesTable.isDefault, true));
    const stages = await db
      .select()
      .from(stagesTable)
      .where(eq(stagesTable.pipelineId, pipeline.id))
      .orderBy(stagesTable.orderIndex);

    const orgs = await db
      .insert(organizationsTable)
      .values(w.orgs.map((o, i) => ({ ...o, ownerId: owners[i % owners.length] })))
      .returning();

    const persons = await db
      .insert(personsTable)
      .values(
        orgs.map((o, i) => ({
          name: `Contact ${i + 1} at ${o.name}`,
          email: `contact${i + 1}@${o.name.toLowerCase().replace(/[^a-z]/g, "")}.test`,
          phone: `+1 555 010${i}`,
          jobTitle: ["Head of Operations", "CFO", "Procurement Lead"][i % 3],
          organizationId: o.id,
          ownerId: o.ownerId,
        })),
      )
      .returning();

    const deals = await db
      .insert(dealsTable)
      .values(
        orgs.flatMap((o, i) => [
          {
            title: `${o.name} - Annual plan`,
            value: 24000 + i * 6000,
            currency: "USD",
            pipelineId: pipeline.id,
            stageId: stages[i % stages.length].id,
            ownerId: o.ownerId,
            creatorUserId: adminId,
            personId: persons[i].id,
            organizationId: o.id,
            expectedCloseDate: dateString(14 + i * 7),
            stageChangeTime: daysFromNow(-i * 3),
          },
          {
            title: `${o.name} - Expansion`,
            value: 9000 + i * 2500,
            currency: "USD",
            pipelineId: pipeline.id,
            stageId: stages[(i + 2) % stages.length].id,
            ownerId: owners[(i + 1) % owners.length],
            creatorUserId: adminId,
            personId: persons[i].id,
            organizationId: o.id,
            expectedCloseDate: dateString(30 + i * 10),
            stageChangeTime: daysFromNow(-i),
          },
        ]),
      )
      .returning();

    await db.insert(activitiesTable).values(
      deals.map((d, i) => ({
        subject: i % 2 === 0 ? "Discovery call" : "Send proposal",
        type: i % 2 === 0 ? ("call" as const) : ("email" as const),
        dueDate: dateString(i - 2),
        dealId: d.id,
        personId: d.personId,
        orgId: d.organizationId,
        ownerId: d.ownerId,
        creatorUserId: adminId,
      })),
    );

    await db.insert(notesTable).values(
      deals.slice(0, 3).map((d) => ({
        content: `Kick-off notes for ${d.title}.`,
        dealId: d.id,
        userId: adminId,
      })),
    );
  });

  logger.info({ workspace: w.name, admin: `admin@${w.domain}` }, "Seeded workspace");
}

async function seed() {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.ALLOW_DESTRUCTIVE_SEED !== "true"
  ) {
    throw new Error(
      "Refusing to run the destructive demo seed in production. " +
        "Set ALLOW_DESTRUCTIVE_SEED=true to override, or use `pnpm run bootstrap` for a safe admin setup.",
    );
  }

  logger.info("Clearing existing data...");
  // Every tenant-scoped row cascades from its tenant.
  await runAsSystem(async () => {
    await db.delete(tenantsTable);
    await db.delete(linkPreviewsTable);
  });

  for (const w of WORKSPACES) await seedWorkspace(w);
  logger.info(`Seed complete. Every demo user's password is "${DEMO_PASSWORD}".`);
}

seed()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    logger.error({ err }, "Seed failed");
    await pool.end().catch(() => {});
    process.exit(1);
  });
