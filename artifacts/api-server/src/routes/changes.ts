import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  db,
  changeEventsTable,
  dealsTable,
  personsTable,
  organizationsTable,
  notesTable,
  usersTable,
} from "@workspace/db";
import {
  GetChangesFeedQueryParams,
  GetChangesFeedResponse,
} from "@workspace/api-zod";
import { currentUser } from "../lib/auth";

const router: IRouter = Router();

// Note events belong to a parent deal/person/org; alias those joins so they
// don't collide with the direct entity joins.
const noteDeal = alias(dealsTable, "note_deal");
const notePerson = alias(personsTable, "note_person");
const noteOrg = alias(organizationsTable, "note_org");

// Recent changes made by OTHERS on records the current user owns. Read-only
// view over the change_events audit log — no unread state.
router.get("/changes/feed", async (req, res): Promise<void> => {
  const parsed = GetChangesFeedQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const limit = parsed.data.limit ?? 15;
  const user = currentUser(res);

  // Owner of the record the event ultimately concerns (the parent entity for
  // notes).
  const targetOwnerId = sql<
    number | null
  >`coalesce(${dealsTable.ownerId}, ${personsTable.ownerId}, ${organizationsTable.ownerId}, ${noteDeal.ownerId}, ${notePerson.ownerId}, ${noteOrg.ownerId})`;

  const items = await db
    .select({
      id: changeEventsTable.id,
      entityType: changeEventsTable.entityType,
      fieldKey: changeEventsTable.fieldKey,
      oldValue: changeEventsTable.oldValue,
      newValue: changeEventsTable.newValue,
      changedByName: usersTable.name,
      source: changeEventsTable.source,
      changedAt: changeEventsTable.changedAt,
      targetType: sql<string>`case
        when ${changeEventsTable.entityType} = 'note' then (case
          when ${notesTable.dealId} is not null then 'deal'
          when ${notesTable.personId} is not null then 'person'
          else 'organization'
        end)
        else ${changeEventsTable.entityType}::text
      end`,
      targetId: sql<number>`(case
        when ${changeEventsTable.entityType} = 'note'
          then coalesce(${notesTable.dealId}, ${notesTable.personId}, ${notesTable.orgId})
        else ${changeEventsTable.entityId}
      end)::int`,
      targetTitle: sql<
        string | null
      >`coalesce(${dealsTable.title}, ${personsTable.name}, ${organizationsTable.name}, ${noteDeal.title}, ${notePerson.name}, ${noteOrg.name})`,
    })
    .from(changeEventsTable)
    .leftJoin(usersTable, eq(changeEventsTable.changedBy, usersTable.id))
    .leftJoin(
      dealsTable,
      and(
        eq(changeEventsTable.entityType, "deal"),
        eq(changeEventsTable.entityId, dealsTable.id),
      ),
    )
    .leftJoin(
      personsTable,
      and(
        eq(changeEventsTable.entityType, "person"),
        eq(changeEventsTable.entityId, personsTable.id),
      ),
    )
    .leftJoin(
      organizationsTable,
      and(
        eq(changeEventsTable.entityType, "organization"),
        eq(changeEventsTable.entityId, organizationsTable.id),
      ),
    )
    .leftJoin(
      notesTable,
      and(
        eq(changeEventsTable.entityType, "note"),
        eq(changeEventsTable.entityId, notesTable.id),
      ),
    )
    .leftJoin(noteDeal, eq(notesTable.dealId, noteDeal.id))
    .leftJoin(notePerson, eq(notesTable.personId, notePerson.id))
    .leftJoin(noteOrg, eq(notesTable.orgId, noteOrg.id))
    .where(
      and(
        inArray(changeEventsTable.entityType, [
          "deal",
          "person",
          "organization",
          "note",
        ]),
        sql`${targetOwnerId} = ${user.id}`,
        // "is distinct from" keeps NULL changed_by (automation/import) rows in.
        sql`${changeEventsTable.changedBy} is distinct from ${user.id}`,
      ),
    )
    .orderBy(desc(changeEventsTable.changedAt), desc(changeEventsTable.id))
    .limit(limit);

  res.json(GetChangesFeedResponse.parse({ items }));
});

export default router;
