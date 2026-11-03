import { Router, type IRouter } from "express";
import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import { db, notificationsTable, usersTable } from "@workspace/db";
import {
  ListNotificationsQueryParams,
  ListNotificationsResponse,
  MarkNotificationReadParams,
  DismissNotificationParams,
} from "@workspace/api-zod";
import { currentUser } from "../lib/auth";

const router: IRouter = Router();

router.get("/notifications", async (req, res): Promise<void> => {
  const parsed = ListNotificationsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const user = currentUser(res);
  const [items, [unread]] = await Promise.all([
    db
      .select({
        id: notificationsTable.id,
        type: notificationsTable.type,
        message: notificationsTable.message,
        actorId: notificationsTable.actorId,
        actorName: usersTable.name,
        entityType: notificationsTable.entityType,
        entityId: notificationsTable.entityId,
        noteId: notificationsTable.noteId,
        readAt: notificationsTable.readAt,
        createdAt: notificationsTable.createdAt,
      })
      .from(notificationsTable)
      .leftJoin(usersTable, eq(usersTable.id, notificationsTable.actorId))
      // Dismissed rows are gone from BOTH surfaces. Read is styling; dismissed
      // is removal — see the column comment on notifications.dismissedAt.
      .where(
        and(
          eq(notificationsTable.userId, user.id),
          isNull(notificationsTable.dismissedAt),
        ),
      )
      .orderBy(desc(notificationsTable.createdAt))
      .limit(parsed.data.limit ?? 50),
    db
      .select({ value: count() })
      .from(notificationsTable)
      .where(
        and(
          eq(notificationsTable.userId, user.id),
          isNull(notificationsTable.readAt),
          isNull(notificationsTable.dismissedAt),
        ),
      ),
  ]);
  res.json(
    ListNotificationsResponse.parse({
      items,
      unreadCount: unread?.value ?? 0,
    }),
  );
});

router.post("/notifications/read-all", async (_req, res): Promise<void> => {
  const user = currentUser(res);
  await db
    .update(notificationsTable)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notificationsTable.userId, user.id),
        isNull(notificationsTable.readAt),
        isNull(notificationsTable.dismissedAt),
      ),
    );
  res.sendStatus(204);
});

router.post("/notifications/:id/read", async (req, res): Promise<void> => {
  const params = MarkNotificationReadParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const user = currentUser(res);
  const [row] = await db
    .update(notificationsTable)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notificationsTable.id, params.data.id),
        eq(notificationsTable.userId, user.id),
      ),
    )
    .returning({ id: notificationsTable.id });
  if (!row) {
    res.status(404).json({ error: "Notification not found" });
    return;
  }
  res.sendStatus(204);
});

/**
 * Explicit dismissal — the X on the home card.
 *
 * Scoped to the signed-in recipient by the same `userId` predicate the read
 * handler uses, so one person can never clear another's row: an id that is not
 * yours 404s rather than silently doing nothing.
 *
 * Idempotent. Dismissing an already-dismissed notification is a 204, because a
 * double-click or a retry must not surface as an error.
 */
router.post("/notifications/:id/dismiss", async (req, res): Promise<void> => {
  const params = DismissNotificationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const user = currentUser(res);
  const now = new Date();
  const [row] = await db
    .update(notificationsTable)
    // Dismissing implies reading it: leaving it unread would keep the bell's
    // badge counting a row nobody can see any more. COALESCE so a re-dismiss
    // (double-click, retry) keeps the ORIGINAL timestamps rather than sliding
    // them forward.
    .set({
      dismissedAt: sql`coalesce(${notificationsTable.dismissedAt}, ${now})`,
      readAt: sql`coalesce(${notificationsTable.readAt}, ${now})`,
    })
    .where(
      and(
        eq(notificationsTable.id, params.data.id),
        eq(notificationsTable.userId, user.id),
      ),
    )
    .returning({ id: notificationsTable.id });
  if (!row) {
    res.status(404).json({ error: "Notification not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
