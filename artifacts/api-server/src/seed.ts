import {
  db,
  pool,
  usersTable,
  pipelinesTable,
  stagesTable,
  organizationsTable,
  personsTable,
  dealsTable,
  activitiesTable,
  notesTable,
  noteReactionsTable,
  linkPreviewsTable,
  crmFilesTable,
  changeEventsTable,
  notificationsTable,
} from "@workspace/db";
import { hashPassword } from "./lib/auth";
import { logger } from "./lib/logger";

const DEMO_PASSWORD = "demo-password-2026";

function daysFromNow(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

function dateString(days: number): string {
  return daysFromNow(days).toISOString().slice(0, 10);
}

async function seed() {
  // This seed is DESTRUCTIVE (it wipes every table). Never let it run against a
  // production database unless explicitly overridden.
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
  // Delete in FK-safe order
  // FKs to deals + users. Blobs live in object storage, not Postgres, so this
  // orphans any seeded blobs in the bucket — acceptable for a dev-only seed.
  await db.delete(crmFilesTable);
  // Also FKs to deals + users.
  // Reactions FK to notes (ON DELETE CASCADE would cover this, but wipe
  // explicitly before notes to keep the delete order self-documenting).
  await db.delete(noteReactionsTable);
  await db.delete(notesTable);
  await db.delete(changeEventsTable);
  await db.delete(notificationsTable);
  // Standalone URL-metadata cache — no FK, order-independent.
  await db.delete(linkPreviewsTable);
  await db.delete(activitiesTable);
  await db.delete(dealsTable);
  await db.delete(personsTable);
  await db.delete(organizationsTable);
  await db.delete(stagesTable);
  await db.delete(pipelinesTable);
  await db.delete(usersTable);

  logger.info("Seeding users...");
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const [admin, omar, sara] = await db
    .insert(usersTable)
    .values([
      {
        name: "Layla Al-Otaibi",
        email: "admin@example.com",
        passwordHash,
        phone: "+966 50 123 4567",
        isAdmin: true,
        defaultCurrency: "SAR",
        timezoneName: "Asia/Riyadh",
      },
      {
        name: "Omar Khalid",
        email: "omar@example.com",
        passwordHash,
        phone: "+966 55 234 5678",
        isAdmin: false,
        defaultCurrency: "SAR",
        timezoneName: "Asia/Riyadh",
      },
      {
        name: "Sara Mansour",
        email: "sara@example.com",
        passwordHash,
        phone: "+966 56 345 6789",
        isAdmin: false,
        defaultCurrency: "SAR",
        timezoneName: "Asia/Riyadh",
      },
    ])
    .returning();

  logger.info("Seeding pipelines & stages...");
  await db.insert(pipelinesTable).values([
    { id: 3, name: "Sales Pipeline" },
    { id: 21, name: "Outbound" },
    { id: 22, name: "Partnerships" },
  ]);

  await db.insert(stagesTable).values([
    // Sales Pipeline (3)
    { id: 14, name: "Lead Qualification", pipelineId: 3, orderIndex: 0, probability: 20, rottingDays: 14 }, // prettier-ignore
    { id: 16, name: "Contact Made", pipelineId: 3, orderIndex: 1, probability: 40, rottingDays: 14 }, // prettier-ignore
    { id: 17, name: "Proposal Sent", pipelineId: 3, orderIndex: 2, probability: 60, rottingDays: 21 }, // prettier-ignore
    { id: 19, name: "Negotiation", pipelineId: 3, orderIndex: 3, probability: 80, rottingDays: 30 }, // prettier-ignore
    // Outbound (21)
    { id: 138, name: "Outreach Made", pipelineId: 21, orderIndex: 0, probability: 10, rottingDays: 7 }, // prettier-ignore
    { id: 76, name: "Responded", pipelineId: 21, orderIndex: 1, probability: 30, rottingDays: 7 }, // prettier-ignore
    { id: 146, name: "Meeting Booked", pipelineId: 21, orderIndex: 2, probability: 50, rottingDays: 14 }, // prettier-ignore
    // Partnerships (22)
    { id: 220, name: "Identified", pipelineId: 22, orderIndex: 0, probability: 15, rottingDays: 30 }, // prettier-ignore
    { id: 221, name: "Contacted", pipelineId: 22, orderIndex: 1, probability: 35, rottingDays: 30 }, // prettier-ignore
    { id: 222, name: "Agreement Sent", pipelineId: 22, orderIndex: 2, probability: 65, rottingDays: 45 }, // prettier-ignore
    { id: 223, name: "Onboarded", pipelineId: 22, orderIndex: 3, probability: 90, rottingDays: null }, // prettier-ignore
  ]);

  logger.info("Seeding organizations...");
  const orgs = await db
    .insert(organizationsTable)
    .values([
      {
        name: "Nakheel Foods",
        address: "Riyadh, Saudi Arabia",
        ownerId: admin.id,
      },
      {
        name: "Qalam Books",
        address: "Riyadh, Saudi Arabia",
        ownerId: omar.id,
      },
      { name: "Souq Wave", address: "Riyadh, Saudi Arabia", ownerId: sara.id },
      {
        name: "Wadi Markets",
        address: "Dammam, Saudi Arabia",
        ownerId: omar.id,
      },
      {
        name: "Shifa Pharmacies",
        address: "Jeddah, Saudi Arabia",
        ownerId: sara.id,
      },
      {
        name: "Barq Electronics",
        address: "Khobar, Saudi Arabia",
        ownerId: admin.id,
      },
    ])
    .returning();

  const orgByName = Object.fromEntries(orgs.map((o) => [o.name, o.id]));

  logger.info("Seeding persons...");
  const persons = await db
    .insert(personsTable)
    .values([
      {
        name: "Faisal Al-Harbi",
        email: "faisal@nakheelfoods.example",
        phone: "+966 50 111 2222",
        organizationId: orgByName["Nakheel Foods"],
        ownerId: admin.id,
      },
      {
        name: "Huda Nasser",
        email: "huda@qalambooks.example",
        phone: "+966 50 222 3333",
        organizationId: orgByName["Qalam Books"],
        ownerId: omar.id,
      },
      {
        name: "Yousef Bin Salman",
        email: "yousef@souqwave.example",
        phone: "+966 50 333 4444",
        organizationId: orgByName["Souq Wave"],
        ownerId: sara.id,
      },
      {
        name: "Maha Al-Dossari",
        email: "maha@wadimarkets.example",
        phone: "+966 50 444 5555",
        organizationId: orgByName["Wadi Markets"],
        ownerId: omar.id,
      },
      {
        name: "Khalid Al-Ghamdi",
        email: "khalid@shifa.example",
        phone: "+966 50 555 6666",
        organizationId: orgByName["Shifa Pharmacies"],
        ownerId: sara.id,
      },
      {
        name: "Reem Al-Qahtani",
        email: "reem@barq.example",
        phone: "+966 50 666 7777",
        organizationId: orgByName["Barq Electronics"],
        ownerId: admin.id,
      },
    ])
    .returning();

  const personByEmail = Object.fromEntries(persons.map((p) => [p.email, p.id]));

  logger.info("Seeding deals...");
  const deals = await db
    .insert(dealsTable)
    .values([
      // Sales Pipeline (3)
      {
        title: "Nakheel - Cold Storage Expansion",
        value: 480000,
        currency: "SAR",
        status: "open",
        pipelineId: 3,
        stageId: 14,
        ownerId: admin.id,
        creatorUserId: admin.id,
        personId: personByEmail["faisal@nakheelfoods.example"],
        organizationId: orgByName["Nakheel Foods"],
        expectedCloseDate: dateString(30),
        stageChangeTime: daysFromNow(-3),
      },
      {
        title: "Qalam - Regional Distribution",
        value: 220000,
        currency: "SAR",
        status: "open",
        pipelineId: 3,
        stageId: 16,
        ownerId: omar.id,
        creatorUserId: omar.id,
        personId: personByEmail["huda@qalambooks.example"],
        organizationId: orgByName["Qalam Books"],
        expectedCloseDate: dateString(21),
        stageChangeTime: daysFromNow(-5),
      },
      {
        title: "Wadi - Fresh Grocery Fulfilment",
        value: 365000,
        currency: "SAR",
        status: "open",
        pipelineId: 3,
        stageId: 17,
        ownerId: omar.id,
        creatorUserId: omar.id,
        personId: personByEmail["maha@wadimarkets.example"],
        organizationId: orgByName["Wadi Markets"],
        expectedCloseDate: dateString(14),
        stageChangeTime: daysFromNow(-2),
      },
      {
        title: "Shifa - Pharma Warehousing",
        value: 540000,
        currency: "SAR",
        status: "open",
        pipelineId: 3,
        stageId: 19,
        ownerId: sara.id,
        creatorUserId: sara.id,
        personId: personByEmail["khalid@shifa.example"],
        organizationId: orgByName["Shifa Pharmacies"],
        expectedCloseDate: dateString(10),
        stageChangeTime: daysFromNow(-1),
      },
      {
        title: "Barq - Electronics 3PL",
        value: 295000,
        currency: "SAR",
        status: "won",
        pipelineId: 3,
        stageId: 19,
        ownerId: admin.id,
        creatorUserId: admin.id,
        personId: personByEmail["reem@barq.example"],
        organizationId: orgByName["Barq Electronics"],
        wonTime: daysFromNow(-4),
        closeTime: daysFromNow(-4),
        stageChangeTime: daysFromNow(-8),
      },
      // Outbound (21)
      {
        title: "Souq Wave - Last Mile Storage",
        value: 410000,
        currency: "SAR",
        status: "open",
        pipelineId: 21,
        stageId: 138,
        ownerId: sara.id,
        creatorUserId: sara.id,
        personId: personByEmail["yousef@souqwave.example"],
        organizationId: orgByName["Souq Wave"],
        utmSource: "linkedin",
        utmCampaign: "q2-outbound",
        stageChangeTime: daysFromNow(-6),
      },
      {
        title: "Nakheel - Secondary DC",
        value: 150000,
        currency: "SAR",
        status: "open",
        pipelineId: 21,
        stageId: 76,
        ownerId: admin.id,
        creatorUserId: admin.id,
        personId: personByEmail["faisal@nakheelfoods.example"],
        organizationId: orgByName["Nakheel Foods"],
        stageChangeTime: daysFromNow(-3),
      },
      {
        title: "Qalam - Returns Hub",
        value: 90000,
        currency: "SAR",
        status: "open",
        pipelineId: 21,
        stageId: 146,
        ownerId: omar.id,
        creatorUserId: omar.id,
        personId: personByEmail["huda@qalambooks.example"],
        organizationId: orgByName["Qalam Books"],
        stageChangeTime: daysFromNow(-2),
      },
      // Partnerships (22)
      {
        title: "Riyadh Freight Co - Linehaul Partner",
        value: 130000,
        currency: "SAR",
        status: "open",
        pipelineId: 22,
        stageId: 220,
        ownerId: omar.id,
        creatorUserId: omar.id,
        organizationId: orgByName["Wadi Markets"],
        stageChangeTime: daysFromNow(-7),
      },
      {
        title: "Jeddah Logistics - Reefer Fleet",
        value: 260000,
        currency: "SAR",
        status: "open",
        pipelineId: 22,
        stageId: 221,
        ownerId: sara.id,
        creatorUserId: sara.id,
        organizationId: orgByName["Shifa Pharmacies"],
        stageChangeTime: daysFromNow(-4),
      },
      {
        title: "Eastern Haulage - Onboarding",
        value: 175000,
        currency: "SAR",
        status: "open",
        pipelineId: 22,
        stageId: 223,
        ownerId: admin.id,
        creatorUserId: admin.id,
        organizationId: orgByName["Barq Electronics"],
        stageChangeTime: daysFromNow(-9),
      },
      {
        title: "Northern Cold Chain - Lost",
        value: 200000,
        currency: "SAR",
        status: "lost",
        pipelineId: 3,
        stageId: 17,
        ownerId: sara.id,
        creatorUserId: sara.id,
        organizationId: orgByName["Souq Wave"],
        lostReason: "Budget constraints",
        lostTime: daysFromNow(-6),
        closeTime: daysFromNow(-6),
        stageChangeTime: daysFromNow(-12),
      },
    ])
    .returning();

  const dealByTitle = Object.fromEntries(deals.map((d) => [d.title, d]));

  logger.info("Seeding activities...");
  await db.insert(activitiesTable).values([
    {
      subject: "Discovery call with Faisal",
      type: "call",
      done: true,
      dealId: dealByTitle["Nakheel - Cold Storage Expansion"].id,
      personId: personByEmail["faisal@nakheelfoods.example"],
      ownerId: admin.id,
      creatorUserId: admin.id,
      markedAsDoneTime: daysFromNow(-3),
      dueDate: dateString(-3),
    },
    {
      subject: "Send cold storage proposal",
      type: "task",
      done: false,
      dealId: dealByTitle["Nakheel - Cold Storage Expansion"].id,
      personId: personByEmail["faisal@nakheelfoods.example"],
      ownerId: admin.id,
      creatorUserId: admin.id,
      dueDate: dateString(2),
    },
    {
      subject: "Site visit - Dammam DC",
      type: "meeting",
      done: false,
      dealId: dealByTitle["Wadi - Fresh Grocery Fulfilment"].id,
      personId: personByEmail["maha@wadimarkets.example"],
      ownerId: omar.id,
      creatorUserId: omar.id,
      dueDate: dateString(3),
      dueTime: "10:00",
      duration: "01:30",
    },
    {
      subject: "Negotiation follow-up",
      type: "call",
      done: false,
      dealId: dealByTitle["Shifa - Pharma Warehousing"].id,
      personId: personByEmail["khalid@shifa.example"],
      ownerId: sara.id,
      creatorUserId: sara.id,
      dueDate: dateString(1),
    },
    {
      subject: "Intro email to Souq Wave ops",
      type: "email",
      done: true,
      dealId: dealByTitle["Souq Wave - Last Mile Storage"].id,
      personId: personByEmail["yousef@souqwave.example"],
      ownerId: sara.id,
      creatorUserId: sara.id,
      markedAsDoneTime: daysFromNow(-6),
      dueDate: dateString(-6),
    },
  ]);

  logger.info("Seeding notes...");
  await db.insert(notesTable).values([
    {
      content:
        "Client needs -18°C frozen capacity for 1,200 pallets. Peak season starts in Q4.",
      dealId: dealByTitle["Nakheel - Cold Storage Expansion"].id,
      userId: admin.id,
      pinnedToDealFlag: true,
    },
    {
      content:
        "Pharma-grade compliance is mandatory; GDP certification required before go-live.",
      dealId: dealByTitle["Shifa - Pharma Warehousing"].id,
      userId: sara.id,
    },
    {
      content: "Won! Contract signed for 12 months, renewable.",
      dealId: dealByTitle["Barq - Electronics 3PL"].id,
      userId: admin.id,
    },
  ]);

  logger.info("Seed complete.");
}

seed()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    logger.error({ err }, "Seed failed");
    await pool.end();
    process.exit(1);
  });
