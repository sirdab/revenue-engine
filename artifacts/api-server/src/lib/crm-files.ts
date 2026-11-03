import { eq, desc, and, or, ne, isNull, isNotNull } from "drizzle-orm";
import {
  db,
  crmFilesTable,
  notesTable,
  dealsTable,
  changeEventsTable,
  type CrmFile,
} from "@workspace/db";
import {
  FILE_CATEGORIES,
  FileValidationError,
  validateUpload,
  requireValidTarget,
  type FileCategory,
} from "./file-validation";
import { putObject, getObject, deleteObject } from "./object-storage";
import { logger } from "./logger";

export {
  FILE_CATEGORIES,
  MAX_FILE_SIZE_BYTES,
  INLINE_PREVIEWABLE_MIME_TYPES,
  FileValidationError,
  contentDispositionHeader,
  type FileCategory,
} from "./file-validation";

// Transactional storage for deal file attachments.
// Metadata lives in Postgres (crm_files); the blob lives in S3-compatible
// object storage (object-storage.ts). No Express types in this module's
// signatures, so a data-migration script can call saveFile directly without
// going through HTTP.

export class FileNotFoundError extends Error {
  constructor(id: number) {
    super(`File ${id} not found`);
  }
}

// Note-target upload failures, mapped to HTTP by routes/files.ts. A foreign
// draft is deliberately indistinguishable from a missing note (NotFound → 404,
// no visibility oracle), matching the notes-route convention.
export class NoteTargetNotFoundError extends Error {
  constructor(noteId: number) {
    super(`Note ${noteId} not found`);
  }
}
export class NoteTargetMismatchError extends Error {
  constructor(noteId: number) {
    super(`Note ${noteId} does not belong to the given deal`);
  }
}

// Not-authorized to delete a note-attached file (posted comment: author/admin
// only — R10). 403.
export class FileForbiddenError extends Error {
  constructor(id: number) {
    super(`Not allowed to modify file ${id}`);
  }
}

export interface SaveFileInput {
  buffer: Buffer;
  fileName: string;
  category: FileCategory;
  dealId: number;
  // Set only for comment attachments (always alongside dealId). The note must
  // exist, belong to dealId, and — when it is still a draft — be owned by the
  // uploader; verified inside the insert transaction.
  noteId?: number | null;
  uploadedBy: number | null;
}

/**
 * Validate, insert metadata + audit row in one Postgres transaction, then
 * write the blob to object storage keyed by the new row's id. Metadata
 * commits first (so the object key is known) — if the object-storage write
 * fails, both the metadata row and its audit row are rolled back so no
 * reader ever sees a file that doesn't exist in storage, and no history
 * view ever shows a "file added" event for a file that was never actually
 * stored; a metadata row that has committed is always assumed to have a
 * real blob behind it (getFileContent depends on this).
 *
 * One transaction per file — including bulk callers — because the
 * change_events dedupe index is unique on (entityType, entityId, fieldKey,
 * changedAt); batching same-entity files under one constant field key would
 * silently drop all but one audit row via onConflictDoNothing. The per-file
 * field key (`file:{id}`) makes this safe regardless of batching, but each
 * caller should still commit one file per transaction.
 */
export async function saveFile(input: SaveFileInput): Promise<CrmFile> {
  requireValidTarget(input.dealId);
  if (!FILE_CATEGORIES.safeParse(input.category).success) {
    throw new FileValidationError(`Unknown file category "${input.category}".`);
  }
  const { fileName, mimeType } = validateUpload(input.buffer, input.fileName);

  const { row, eventId } = await db.transaction(async (tx) => {
    // Comment attachment: verify the note under a row lock so a concurrent
    // note delete serializes (the delete path also locks the note, then reaps
    // crm_files children first). A draft-targeted upload writes no history
    // event — the "file added" event is deferred until the draft is posted.
    let noteIsDraft = false;
    if (input.noteId != null) {
      const [note] = await tx
        .select({
          dealId: notesTable.dealId,
          draft: notesTable.draft,
          userId: notesTable.userId,
        })
        .from(notesTable)
        .where(eq(notesTable.id, input.noteId))
        .for("update");
      if (!note) throw new NoteTargetNotFoundError(input.noteId);
      if (note.dealId !== input.dealId) {
        throw new NoteTargetMismatchError(input.noteId);
      }
      // A foreign draft is invisible → NotFound (no visibility oracle).
      if (note.draft && note.userId !== input.uploadedBy) {
        throw new NoteTargetNotFoundError(input.noteId);
      }
      noteIsDraft = note.draft;
    }

    const [inserted] = await tx
      .insert(crmFilesTable)
      .values({
        fileName,
        mimeType,
        sizeBytes: input.buffer.length,
        category: input.category,
        dealId: input.dealId ?? null,
        noteId: input.noteId ?? null,
        uploadedBy: input.uploadedBy,
      })
      .returning();

    // Draft-targeted uploads defer their history event to post time; every
    // other target (deal, account, already-posted comment) logs immediately.
    if (noteIsDraft) {
      return { row: inserted, eventId: null as number | null };
    }
    const [event] = await tx
      .insert(changeEventsTable)
      .values([
        {
          entityType: "deal",
          entityId: input.dealId,
          fieldKey: `file:${inserted.id}`,
          oldValue: null,
          newValue: { id: inserted.id, label: fileName },
          changedBy: input.uploadedBy,
          source: "ui",
        },
      ])
      .returning();

    return { row: inserted, eventId: event.id as number | null };
  });

  try {
    await putObject(row.id, input.buffer, mimeType);
  } catch (err) {
    logger.error({ err, fileId: row.id }, "Object storage write failed; rolling back metadata");
    try {
      // Both deletes in one transaction: if only crmFilesTable were deleted
      // and changeEventsTable's delete then failed, getFileContent would
      // 404 (not 500) for this id, but the orphaned change_events row would
      // still render as a phantom "file added" entry in history views.
      // Doing both atomically means either both rows are gone or neither is.
      // A draft-targeted save has no event to undo (eventId is null).
      await db.transaction(async (tx) => {
        await tx.delete(crmFilesTable).where(eq(crmFilesTable.id, row.id));
        if (eventId != null) {
          await tx
            .delete(changeEventsTable)
            .where(eq(changeEventsTable.id, eventId));
        }
      });
    } catch (rollbackErr) {
      logger.error(
        { rollbackErr, originalErr: err, fileId: row.id, eventId },
        "ORPHANED ROW: failed to roll back crm_files/change_events after an object storage " +
          "write failure -- manual cleanup required (crm_files row and its change_events " +
          "audit row both still exist; getFileContent will 404, not 500, for this file id)",
      );
    }
    throw err;
  }

  return row;
}

export interface FileContent {
  meta: CrmFile;
  data: Buffer;
  // True when this file is attached to a DRAFT note. Draft images must never be
  // disk-cached (auth can change before the draft is even posted), so the route
  // keeps `no-store` for them (U6 caching).
  isDraftNote: boolean;
}

/**
 * Fetch a file's bytes, applying the draft exclusion in SQL: a comment
 * attachment whose note is a draft is visible only to the draft's creator.
 * `currentUserId` is REQUIRED so no caller can forget the check — the by-id
 * content route is the most-linked, integer-enumerable surface, so a foreign
 * draft's attachment must 404 (returns null) just like the note route does.
 */
export async function getFileContent(
  id: number,
  currentUserId: number | null,
): Promise<FileContent | null> {
  const [meta] = await db
    .select({
      file: crmFilesTable,
      noteDraft: notesTable.draft,
      noteUserId: notesTable.userId,
    })
    .from(crmFilesTable)
    .leftJoin(notesTable, eq(crmFilesTable.noteId, notesTable.id))
    .where(eq(crmFilesTable.id, id));
  if (!meta) return null;
  // Foreign draft's attachment → invisible (404), same as the note itself.
  if (meta.noteDraft && meta.noteUserId !== currentUserId) return null;
  const data = await getObject(id);
  return { meta: meta.file, data, isDraftNote: meta.noteDraft === true };
}

export type FileTarget =
  // Deal Documents card: deal-scoped files only, never comment attachments.
  | { dealId: number }
  // A single note's attachments (the route checks note visibility first).
  | { noteId: number }
  // Every POSTED comment's attachments on a deal, in one query (the timeline).
  | { dealNoteAttachments: number };

export async function listFiles(target: FileTarget): Promise<CrmFile[]> {
  if ("noteId" in target) {
    return db
      .select()
      .from(crmFilesTable)
      .where(eq(crmFilesTable.noteId, target.noteId))
      .orderBy(desc(crmFilesTable.addTime));
  }
  if ("dealNoteAttachments" in target) {
    // Attachments on posted comments of this deal, joined to notes so draft
    // comments' attachments never leak into the shared timeline view.
    const rows = await db
      .select({ file: crmFilesTable })
      .from(crmFilesTable)
      .innerJoin(notesTable, eq(crmFilesTable.noteId, notesTable.id))
      .where(
        and(
          eq(crmFilesTable.dealId, target.dealNoteAttachments),
          isNotNull(crmFilesTable.noteId),
          eq(notesTable.draft, false),
        ),
      )
      .orderBy(desc(crmFilesTable.addTime));
    return rows.map((r) => r.file);
  }
  // Deal docs only — comment attachments (note_id set) are excluded.
  const condition = and(
    eq(crmFilesTable.dealId, target.dealId),
    isNull(crmFilesTable.noteId),
  );
  return db
    .select()
    .from(crmFilesTable)
    .where(condition)
    .orderBy(desc(crmFilesTable.addTime));
}

/**
 * Best-effort delete of R2 blobs after their crm_files rows are gone. Per-id
 * try/catch so a mid-loop failure keeps going and every failure is logged — a
 * failed delete leaves a discoverable orphan blob (reconcilable via a set-diff
 * against crm_files ids), never a silent one.
 */
export async function deleteBlobs(ids: number[]): Promise<void> {
  for (const id of ids) {
    try {
      await deleteObject(id);
    } catch (err) {
      logger.error(
        { err, fileId: id },
        "Failed to delete object-storage blob (orphaned blob left for reconciliation)",
      );
    }
  }
}

/**
 * Delete metadata + audit row in one transaction first — that's the app's
 * source of truth, so the file disappears from every list/read immediately.
 * The object-storage delete happens after and best-effort: if it fails, the
 * orphaned blob is a cheap cleanup item, not a correctness problem (nothing
 * still references it).
 *
 * Deal/account files stay flat-and-hard for any authenticated user (the
 * notes-route precedent). Comment attachments are gated (R10): a draft's
 * attachment is creator-only; a posted comment's attachment is author-or-admin
 * only — otherwise this legacy route would bypass the note permission model.
 * A draft attachment logs no history event (draft-stage stays silent).
 */
export async function deleteFile(
  id: number,
  actor: { userId: number | null; isAdmin: boolean },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [meta] = await tx
      .select()
      .from(crmFilesTable)
      .where(eq(crmFilesTable.id, id));
    if (!meta) {
      throw new FileNotFoundError(id);
    }

    let noteIsDraft = false;
    if (meta.noteId != null) {
      const [note] = await tx
        .select({ draft: notesTable.draft, userId: notesTable.userId })
        .from(notesTable)
        .where(eq(notesTable.id, meta.noteId));
      // A dangling note ref shouldn't happen (delete reaps children first), but
      // treat a missing note as not-found rather than crash.
      if (!note) throw new FileNotFoundError(id);
      noteIsDraft = note.draft;
      const isOwner = note.userId === actor.userId;
      // Draft: creator only. Posted: author or admin.
      const allowed = noteIsDraft ? isOwner : isOwner || actor.isAdmin;
      if (!allowed) throw new FileForbiddenError(id);
    }

    await tx.delete(crmFilesTable).where(eq(crmFilesTable.id, id));

    // Draft attachments produce no history until (and unless) the draft posts.
    if (!noteIsDraft) {
      await tx.insert(changeEventsTable).values([
        {
          entityType: "deal",
          entityId: meta.dealId,
          fieldKey: `file:${id}`,
          oldValue: { id, label: meta.fileName },
          newValue: null,
          changedBy: actor.userId,
          source: "ui",
        },
      ]);
    }
  });

  try {
    await deleteObject(id);
  } catch (err) {
    logger.error({ err, fileId: id }, "Failed to delete object storage blob after metadata delete");
  }
}
