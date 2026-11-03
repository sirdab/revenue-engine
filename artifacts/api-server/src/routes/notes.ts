import { Router, type IRouter } from "express";
import { and, desc, eq, or, type SQL } from "drizzle-orm";
import { db, notesTable, crmFilesTable, changeEventsTable } from "@workspace/db";
import { deleteBlobs } from "../lib/crm-files";
import {
  ListNotesQueryParams,
  ListNotesResponse,
  ListNotesResponseItem,
  CreateNoteBody,
  UpdateNoteParams,
  UpdateNoteBody,
  UpdateNoteResponse,
  DeleteNoteParams,
  PostNoteParams,
  PostNoteResponse,
  GetNoteHistoryParams,
  GetNoteHistoryResponse,
  AddNoteReactionParams,
  RemoveNoteReactionParams,
} from "@workspace/api-zod";
import {
  noteQuery,
  loadNoteById,
  isDealArchived,
  ARCHIVED_DEAL_ERROR,
  stripFalsyBooleanParams,
} from "../lib/queries";
import { currentUser } from "../lib/auth";
import {
  logEntityEvent,
  logFieldChanges,
  TRACKED_NOTE_FIELDS,
  loadEntityHistory,
} from "../lib/change-events";
import { notifyMentions } from "../lib/mentions";
import { logger } from "../lib/logger";
import {
  addReaction,
  removeReaction,
  loadReactionsForNotes,
  NoteNotVisibleError,
  ReactionEmojiError,
} from "../lib/note-reactions";
import {
  unfurlCommentUrls,
  loadPreviewsForNotes,
} from "../lib/link-preview";

const summarize = (content: string): string =>
  content.length > 80 ? `${content.slice(0, 80)}…` : content;

const router: IRouter = Router();

router.get("/notes", async (req, res): Promise<void> => {
  // `includeDrafts=false` must read as absent, not coerce to true.
  const parsed = ListNotesQueryParams.safeParse(
    stripFalsyBooleanParams(req.query, ["includeDrafts"]),
  );
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { dealId, personId, orgId, includeDrafts, limit } = parsed.data;
  const user = currentUser(res);
  // Drafts are excluded by default; includeDrafts only ever adds the caller's
  // own drafts — other users' drafts are never returned (enforced in SQL).
  const conditions: SQL[] = [
    eq(notesTable.activeFlag, true),
    includeDrafts
      ? or(eq(notesTable.draft, false), eq(notesTable.userId, user.id))!
      : eq(notesTable.draft, false),
  ];
  if (dealId) conditions.push(eq(notesTable.dealId, dealId));
  if (personId) conditions.push(eq(notesTable.personId, personId));
  if (orgId) conditions.push(eq(notesTable.orgId, orgId));

  const rows = await noteQuery()
    .where(and(...conditions))
    .orderBy(desc(notesTable.addTime))
    .limit(limit ?? 200);
  // Reaction aggregates ride the list response — one batched query for every
  // note, never per-note (the list holds up to 200).
  const [reactionsByNote, previewsByNote] = await Promise.all([
    loadReactionsForNotes(
      rows.map((r) => r.id),
      user.id,
    ),
    loadPreviewsForNotes(rows.map((r) => ({ id: r.id, content: r.content }))),
  ]);
  const enriched = rows.map((r) => ({
    ...r,
    reactions: reactionsByNote.get(r.id) ?? [],
    previews: previewsByNote.get(r.id) ?? [],
  }));
  res.json(ListNotesResponse.parse(enriched));
});

router.post("/notes", async (req, res): Promise<void> => {
  const parsed = CreateNoteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const d = parsed.data;
  const user = currentUser(res);
  // Archived deals are read-only — no new linked notes.
  if (await isDealArchived(d.dealId)) {
    res.status(409).json({ error: ARCHIVED_DEAL_ERROR });
    return;
  }
  const draft = d.draft ?? false;
  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(notesTable)
      .values({
        content: d.content,
        dealId: d.dealId ?? null,
        personId: d.personId ?? null,
        orgId: d.orgId ?? null,
        userId: user.id,
        draft,
        pinnedToDealFlag: d.pinnedToDealFlag ?? false,
        pinnedToPersonFlag: d.pinnedToPersonFlag ?? false,
        pinnedToOrganizationFlag: d.pinnedToOrganizationFlag ?? false,
      })
      .returning();
    // The History tab is visible to everyone; a draft logs nothing until it
    // is posted (the "created" event fires at post time instead).
    if (!draft) {
      await logEntityEvent(tx, "note", row.id, "created", null, { id: row.id, label: summarize(row.content) }, {
        changedBy: user.id,
        source: "ui",
      });
    }
    return row;
  });
  // Mentions fire after commit and never block the response — but a draft
  // stays silent until it is posted (see POST /notes/:id/post).
  if (!draft) {
    void notifyMentions({
      content: created.content,
      actor: { id: user.id, name: user.name },
      target: created,
      noteId: created.id,
    });
    void unfurlCommentUrls(created.content, user.id);
  }
  const note = await loadNoteById(created.id);
  res.status(201).json(ListNotesResponseItem.parse(note));
});

router.patch("/notes/:id", async (req, res): Promise<void> => {
  const params = UpdateNoteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateNoteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const user = currentUser(res);
  const updated = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(notesTable)
      .where(eq(notesTable.id, params.data.id))
      .for("update");
    if (!existing) return null;
    // Drafts are creator-only (a foreign draft 404s like a missing row) and
    // log no history until posted.
    if (existing.draft && existing.userId !== user.id) return null;
    // Posted comments: only the author or an admin may edit (R10).
    if (!existing.draft && existing.userId !== user.id && !user.isAdmin) {
      return "forbidden" as const;
    }
    // Archived deals are read-only, their comments included (same as create).
    if (await isDealArchived(existing.dealId)) return "archived" as const;
    const [row] = await tx
      .update(notesTable)
      .set(parsed.data)
      .where(eq(notesTable.id, params.data.id))
      .returning();
    // Drafts log no history until they're posted.
    if (!existing.draft) {
      await logFieldChanges(
        tx,
        "note",
        [{ entityId: row.id, before: existing, patch: parsed.data }],
        TRACKED_NOTE_FIELDS,
        { changedBy: user.id, source: "ui" },
      );
    }
    return { row, previousContent: existing.content, wasDraft: existing.draft };
  });
  if (updated === "forbidden") {
    res.status(403).json({ error: "You can only edit your own comments." });
    return;
  }
  if (updated === "archived") {
    res.status(409).json({ error: ARCHIVED_DEAL_ERROR });
    return;
  }
  if (!updated) {
    res.status(404).json({ error: "Note not found" });
    return;
  }
  // Posted notes only: notify users NEWLY mentioned by this edit. A note that
  // is still a draft stays silent until it is posted.
  if (!updated.wasDraft && parsed.data.content !== undefined) {
    void notifyMentions({
      content: updated.row.content,
      previousContent: updated.previousContent,
      actor: { id: user.id, name: user.name },
      target: updated.row,
      noteId: updated.row.id,
    });
    // Re-unfurl on edit: a URL added now gets a card, a removed one drops (its
    // extraction no longer matches, so the list simply stops attaching it).
    void unfurlCommentUrls(updated.row.content, user.id);
  }
  const note = await loadNoteById(updated.row.id);
  res.json(UpdateNoteResponse.parse(note));
});

router.delete("/notes/:id", async (req, res): Promise<void> => {
  const params = DeleteNoteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const user = currentUser(res);
  const result = await db.transaction(async (tx) => {
    // Lock the note so a racing attachment upload (which also locks the note)
    // serializes against this delete — then reap its crm_files children first
    // (the FK is immediate NO ACTION), so a concurrent upload's row is either
    // reaped here or its insert 404s because the note is already gone. Never an
    // orphan.
    const [existing] = await tx
      .select()
      .from(notesTable)
      .where(eq(notesTable.id, params.data.id))
      .for("update");
    if (!existing) return { kind: "notfound" as const };
    // Draft: creator-only (a foreign draft 404s like a missing row). Posted
    // comment: author or admin (R10).
    if (existing.draft) {
      if (existing.userId !== user.id) return { kind: "notfound" as const };
    } else if (existing.userId !== user.id && !user.isAdmin) {
      return { kind: "forbidden" as const };
    }
    // Archived deals are read-only, their comments included (same as create).
    // Discarding your own draft stays allowed: it can never be posted there,
    // and otherwise it could never be removed either.
    if (!existing.draft && (await isDealArchived(existing.dealId))) {
      return { kind: "archived" as const };
    }

    // Reap attachment rows, capturing ids for the post-commit blob cleanup.
    const files = await tx
      .delete(crmFilesTable)
      .where(eq(crmFilesTable.noteId, existing.id))
      .returning({
        id: crmFilesTable.id,
        fileName: crmFilesTable.fileName,
        dealId: crmFilesTable.dealId,
      });

    // Delete the note; note_reactions cascade via their ON DELETE CASCADE FK.
    await tx.delete(notesTable).where(eq(notesTable.id, existing.id));

    // A draft leaves no trace; a posted comment logs its own deletion plus one
    // removal event per attachment (per-file file:{id} key, so a batch isn't
    // collapsed by the change_events dedupe index).
    if (!existing.draft) {
      await logEntityEvent(
        tx,
        "note",
        existing.id,
        "deleted",
        { id: existing.id, label: summarize(existing.content) },
        null,
        { changedBy: user.id, source: "ui" },
      );
      if (files.length) {
        await tx.insert(changeEventsTable).values(
          files.map((f) => ({
            entityType: "deal" as const,
            entityId: f.dealId as number,
            fieldKey: `file:${f.id}`,
            oldValue: { id: f.id, label: f.fileName },
            newValue: null,
            changedBy: user.id,
            source: "ui" as const,
          })),
        );
      }
    }
    return { kind: "ok" as const, fileIds: files.map((f) => f.id) };
  });

  if (result.kind === "notfound") {
    res.status(404).json({ error: "Note not found" });
    return;
  }
  if (result.kind === "forbidden") {
    res.status(403).json({ error: "You can only delete your own comments." });
    return;
  }
  if (result.kind === "archived") {
    res.status(409).json({ error: ARCHIVED_DEAL_ERROR });
    return;
  }
  // Log the reaped file ids at commit BEFORE deleting blobs. This makes the
  // one unavoidable race — an upload committing its crm_files row (and writing
  // its R2 blob post-commit) just as this delete reaps that row — discoverable:
  // if the upload's putObject lands after deleteBlobs, the orphaned blob's id
  // is in this log line (and in the reconciliation set-diff), never silent.
  if (result.fileIds.length) {
    logger.info(
      { noteId: params.data.id, fileIds: result.fileIds },
      "note delete: reaping attachment blobs",
    );
    await deleteBlobs(result.fileIds);
  }
  res.sendStatus(204);
});

// Publish a draft. One-way transition: `addTime` is reset to the post time so
// the note sorts as new, and the "created" history event fires now (nothing
// was logged while it was a draft). Posting an already-posted note is an
// idempotent no-op.
router.post("/notes/:id/post", async (req, res): Promise<void> => {
  const params = PostNoteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const user = currentUser(res);
  const posted = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(notesTable)
      .where(eq(notesTable.id, params.data.id))
      .for("update");
    if (!existing) return null;
    if (existing.draft && existing.userId !== user.id) return null;
    if (!existing.draft) return { row: existing, published: false };
    // Archived deals are read-only — a draft linked to one cannot post.
    if (await isDealArchived(existing.dealId)) return "archived" as const;
    const [row] = await tx
      .update(notesTable)
      .set({ draft: false, addTime: new Date() })
      .where(eq(notesTable.id, params.data.id))
      .returning();
    await logEntityEvent(tx, "note", row.id, "created", null, { id: row.id, label: summarize(row.content) }, {
      changedBy: user.id,
      source: "ui",
    });
    // Attachments uploaded while this was a draft logged nothing; their "file
    // added" events fire now, one per file (per-file key so the change_events
    // dedupe index doesn't collapse a multi-attachment post to a single row).
    const files = await tx
      .select({
        id: crmFilesTable.id,
        fileName: crmFilesTable.fileName,
        dealId: crmFilesTable.dealId,
      })
      .from(crmFilesTable)
      .where(eq(crmFilesTable.noteId, row.id));
    if (files.length) {
      await tx.insert(changeEventsTable).values(
        files.map((f) => ({
          entityType: "deal" as const,
          entityId: f.dealId as number,
          fieldKey: `file:${f.id}`,
          oldValue: null,
          newValue: { id: f.id, label: f.fileName },
          changedBy: user.id,
          source: "ui" as const,
        })),
      );
    }
    return { row, published: true };
  });
  if (posted === "archived") {
    res.status(409).json({ error: ARCHIVED_DEAL_ERROR });
    return;
  }
  if (!posted) {
    res.status(404).json({ error: "Note not found" });
    return;
  }
  // Publishing a draft is its first chance to notify — it stayed silent while
  // a draft, so every mention fires here (no previousContent diff).
  if (posted.published) {
    void notifyMentions({
      content: posted.row.content,
      actor: { id: user.id, name: user.name },
      target: posted.row,
      noteId: posted.row.id,
    });
    void unfurlCommentUrls(posted.row.content, user.id);
  }
  const note = await loadNoteById(posted.row.id);
  res.json(PostNoteResponse.parse(note));
});

router.get("/notes/:id/history", async (req, res): Promise<void> => {
  const params = GetNoteHistoryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const user = currentUser(res);
  const note = await loadNoteById(params.data.id);
  // A foreign draft is invisible — indistinguishable from a missing row.
  if (!note || (note.draft && note.userId !== user.id)) {
    res.status(404).json({ error: "Note not found" });
    return;
  }
  const events = await loadEntityHistory("note", params.data.id);
  res.json(GetNoteHistoryResponse.parse({ events }));
});

// Emoji reactions on posted comments (R9). Both routes key the row on the
// SESSION user id, so a request can never add/remove another user's reaction;
// both are idempotent. Reactions deliberately log no change event and send no
// notification (deferred — see Scope Boundaries).
router.put("/notes/:id/reactions/:emoji", async (req, res): Promise<void> => {
  const params = AddNoteReactionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const user = currentUser(res);
  try {
    await addReaction(params.data.id, params.data.emoji, user.id);
    res.sendStatus(204);
  } catch (err) {
    if (err instanceof ReactionEmojiError) {
      res.status(400).json({ error: "Unsupported reaction." });
      return;
    }
    if (err instanceof NoteNotVisibleError) {
      res.status(404).json({ error: "Note not found" });
      return;
    }
    // A concurrent note delete surfaces as an FK violation → 404, not 500.
    if (isForeignKeyViolation(err)) {
      res.status(404).json({ error: "Note not found" });
      return;
    }
    throw err;
  }
});

router.delete("/notes/:id/reactions/:emoji", async (req, res): Promise<void> => {
  const params = RemoveNoteReactionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const user = currentUser(res);
  try {
    await removeReaction(params.data.id, params.data.emoji, user.id);
    res.sendStatus(204);
  } catch (err) {
    if (err instanceof ReactionEmojiError) {
      res.status(400).json({ error: "Unsupported reaction." });
      return;
    }
    if (err instanceof NoteNotVisibleError) {
      res.status(404).json({ error: "Note not found" });
      return;
    }
    throw err;
  }
});

// Postgres FK-violation SQLSTATE (a reaction insert racing a note delete).
function isForeignKeyViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "23503"
  );
}

export default router;
