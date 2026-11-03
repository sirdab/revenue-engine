import { Router, type IRouter } from "express";
import { MulterError } from "multer";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, dealsTable } from "@workspace/db";
import { currentUser } from "../lib/auth";
import { ARCHIVED_DEAL_ERROR } from "../lib/queries";
import { logger } from "../lib/logger";
import { fileUploadRateLimiter } from "../lib/rate-limit";
import {
  FILE_CATEGORIES,
  MAX_FILE_SIZE_BYTES,
  INLINE_PREVIEWABLE_MIME_TYPES,
  FileValidationError,
  contentDispositionHeader,
  saveFile,
  listFiles,
  getFileContent,
  deleteFile,
  FileNotFoundError,
  NoteTargetNotFoundError,
  NoteTargetMismatchError,
  FileForbiddenError,
} from "../lib/crm-files";
import { notesTable } from "@workspace/db";
import { fileUpload as upload } from "../lib/file-upload-config";

// Spec-less router (no OpenAPI/Orval — the generated client can't carry
// multipart) for deal file attachments. Mounted below
// requireAuth in routes/index.ts.

const router: IRouter = Router();

// Upload target: a deal's documents, or a comment attachment (deal + note).
const TargetBody = z.object({
  dealId: z.coerce.number().int().positive(),
  noteId: z.coerce.number().int().positive().optional(),
  category: FILE_CATEGORIES,
});

// List target: exactly one of dealId (deal docs; add noteAttachments=true for a
// deal's posted-comment attachments) or noteId (one note's).
const ListQuery = z
  .object({
    dealId: z.coerce.number().int().positive().optional(),
    noteId: z.coerce.number().int().positive().optional(),
    // z.enum, not z.coerce.boolean() — "false" coerces truthy otherwise.
    noteAttachments: z.enum(["true", "false"]).optional(),
  })
  .refine(
    (b) => [b.dealId, b.noteId].filter((v) => v != null).length === 1,
    "Exactly one of dealId or noteId is required.",
  );

router.post(
  "/files",
  fileUploadRateLimiter,
  (req, res, next) => {
    upload.single("file")(req, res, (err: unknown) => {
      if (!err) {
        next();
        return;
      }
      if (err instanceof MulterError && err.code === "LIMIT_FILE_SIZE") {
        res.status(400).json({
          error: `File exceeds the ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB limit.`,
        });
        return;
      }
      res.status(400).json({ error: err instanceof Error ? err.message : "Upload failed." });
    });
  },
  async (req, res): Promise<void> => {
    const parsed = TargetBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: "File is required." });
      return;
    }
    const { category, dealId, noteId } = parsed.data;
    const user = currentUser(res);

    const [deal] = await db
      .select({ archived: dealsTable.archived, status: dealsTable.status })
      .from(dealsTable)
      .where(eq(dealsTable.id, dealId));
    if (!deal) {
      res.status(404).json({ error: "Deal not found." });
      return;
    }
    if (deal.archived || deal.status === "deleted") {
      res.status(409).json({ error: ARCHIVED_DEAL_ERROR });
      return;
    }

    try {
      const file = await saveFile({
        buffer: req.file.buffer,
        fileName: req.file.originalname,
        category,
        dealId,
        noteId: noteId ?? null,
        uploadedBy: user.id,
      });
      res.status(201).json(file);
    } catch (err) {
      if (err instanceof NoteTargetNotFoundError) {
        // A racing note delete lands here too — never an orphaned row.
        res.status(404).json({ error: "Note not found." });
        return;
      }
      if (err instanceof NoteTargetMismatchError) {
        res.status(400).json({ error: "Note does not belong to that deal." });
        return;
      }
      if (err instanceof FileValidationError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

router.get("/files", async (req, res): Promise<void> => {
  const parsed = ListQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { dealId, noteId, noteAttachments } = parsed.data;
  const user = currentUser(res);

  if (noteId != null) {
    // A single note's attachments — visible only if the note is visible to the
    // caller (a foreign draft 404s, matching the note route).
    const [note] = await db
      .select({ draft: notesTable.draft, userId: notesTable.userId })
      .from(notesTable)
      .where(eq(notesTable.id, noteId));
    if (!note || (note.draft && note.userId !== user.id)) {
      res.status(404).json({ error: "Note not found." });
      return;
    }
    res.json(await listFiles({ noteId }));
    return;
  }

  // noteAttachments=true → this deal's posted-comment attachments (timeline);
  // otherwise the deal Documents card (comment attachments excluded).
  res.json(
    await listFiles(
      noteAttachments === "true"
        ? { dealNoteAttachments: dealId as number }
        : { dealId: dealId as number },
    ),
  );
});

router.get("/files/:id/content", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "id must be a positive integer." });
    return;
  }
  const user = currentUser(res);
  // Draft exclusion is applied in SQL: a foreign draft's attachment 404s.
  const result = await getFileContent(id, user.id);
  if (!result) {
    res.status(404).json({ error: "File not found." });
    return;
  }
  const { meta, data, isDraftNote } = result;
  const inline = INLINE_PREVIEWABLE_MIME_TYPES.has(meta.mimeType);
  const csp =
    meta.mimeType === "application/pdf"
      ? "default-src 'none'"
      : inline
        ? "default-src 'none'; sandbox"
        : "default-src 'none'";

  // Inline images on POSTED comments (and deal files) get a bounded
  // private cache so long threads don't refetch every image on every mount.
  // Bytes are immutable per id, but AUTHORIZATION isn't — a deleted comment's
  // screenshot must not live on for a year — so the TTL is short (1 day). Draft
  // images and non-image types stay no-store (U6 caching KTD).
  const isImage = meta.mimeType.startsWith("image/");
  const cacheControl =
    isImage && !isDraftNote ? "private, max-age=86400" : "private, no-store";

  res.setHeader("Content-Type", meta.mimeType);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", cacheControl);
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Content-Security-Policy", csp);
  res.setHeader(
    "Content-Disposition",
    contentDispositionHeader(inline ? "inline" : "attachment", meta.fileName),
  );
  res.send(data);
});

router.delete("/files/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "id must be a positive integer." });
    return;
  }
  const user = currentUser(res);
  try {
    await deleteFile(id, { userId: user.id, isAdmin: user.isAdmin });
    res.sendStatus(204);
  } catch (err) {
    if (err instanceof FileForbiddenError) {
      // Only a comment's author/admin may remove its attachments (R10).
      res.status(403).json({ error: "You can't remove this attachment." });
      return;
    }
    if (err instanceof FileNotFoundError) {
      res.status(404).json({ error: "File not found." });
      return;
    }
    throw err;
  }
});

export default router;
