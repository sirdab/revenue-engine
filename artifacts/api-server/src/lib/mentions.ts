import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  notificationsTable,
  usersTable,
  dealsTable,
  personsTable,
  organizationsTable,
} from "@workspace/db";
import { logger } from "./logger";
import { notify } from "./notifications";
import { extractMentionUserIds } from "./mentions-parse";

// Re-exported so existing importers of `./mentions` keep working; the parser
// itself now lives in the dependency-free mentions-parse.ts (CI-testable).
export { extractMentionUserIds, MENTION_RE } from "./mentions-parse";

// ---------------------------------------------------------------------------
// @mention notifications (CS ask: make the note editor's @-tags actually reach
// the tagged person — inside the CRM, not the Slack channel).
//
// The rich note editor embeds mentions as `<span data-mention="<userId>">…`
// chips inside the note's HTML content. After a note (or an activity's note)
// is written, the routes call `notifyMentions`, which diffs the mention ids
// against the previous content, creates one in-app notification row per newly
// mentioned user, and routes an email through notify(). Fire-and-forget: it
// runs AFTER the write committed and never throws.
// ---------------------------------------------------------------------------

/** The entity the note hangs off — used for the message text and the link. */
interface MentionTarget {
  dealId?: number | null;
  personId?: number | null;
  orgId?: number | null;
}

export interface MentionContext {
  /** New note/activity-note HTML. */
  content: string | null | undefined;
  /** Previous HTML on update — only NEWLY added mentions notify. */
  previousContent?: string | null;
  /** The note author; never notified about mentioning themselves. */
  actor: { id: number; name: string };
  target: MentionTarget;
  noteId?: number;
}

async function resolveTarget(
  target: MentionTarget,
): Promise<{ entityType: string; entityId: number; label: string; path: string } | null> {
  if (target.dealId) {
    const [deal] = await db
      .select({ title: dealsTable.title })
      .from(dealsTable)
      .where(eq(dealsTable.id, target.dealId));
    return {
      entityType: "deal",
      entityId: target.dealId,
      label: deal ? `deal “${deal.title}”` : "a deal",
      path: `/deal/${target.dealId}`,
    };
  }
  if (target.personId) {
    const [person] = await db
      .select({ name: personsTable.name })
      .from(personsTable)
      .where(eq(personsTable.id, target.personId));
    return {
      entityType: "person",
      entityId: target.personId,
      label: person ? `contact “${person.name}”` : "a contact",
      path: `/person/${target.personId}`,
    };
  }
  if (target.orgId) {
    const [org] = await db
      .select({ name: organizationsTable.name })
      .from(organizationsTable)
      .where(eq(organizationsTable.id, target.orgId));
    return {
      entityType: "organization",
      entityId: target.orgId,
      label: org ? `organization “${org.name}”` : "an organization",
      path: `/organization/${target.orgId}`,
    };
  }
  return null;
}

/**
 * Create in-app notifications (and emails via notify()) for users newly
 * @-mentioned in a note. Never throws — call it fire-and-forget after the
 * note write has committed.
 */
export async function notifyMentions(ctx: MentionContext): Promise<void> {
  try {
    const previous = new Set(extractMentionUserIds(ctx.previousContent));
    const ids = extractMentionUserIds(ctx.content).filter(
      (id) => id !== ctx.actor.id && !previous.has(id),
    );
    if (!ids.length) return;

    const recipients = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(and(inArray(usersTable.id, ids), eq(usersTable.activeFlag, true)));
    if (!recipients.length) return;

    const resolved = await resolveTarget(ctx.target);
    const label = resolved?.label ?? "a note";
    const message = `${ctx.actor.name} mentioned you in a note on ${label}`;

    await db.insert(notificationsTable).values(
      recipients.map((u) => ({
        userId: u.id,
        actorId: ctx.actor.id,
        type: "mention",
        message,
        entityType: resolved?.entityType ?? null,
        entityId: resolved?.entityId ?? null,
        noteId: ctx.noteId ?? null,
      })),
    );

    await Promise.all(
      recipients.map((u) =>
        notify({
          type: "mentioned",
          userId: u.id,
          actorName: ctx.actor.name,
          entityLabel: label,
          path: resolved?.path ?? "/home",
        }),
      ),
    );
  } catch (err) {
    logger.error({ err }, "Failed to create mention notifications");
  }
}
