import path from "path";
import { z } from "zod";

// Upload hardening (R5, R6): extension allowlist, magic bytes, filename
// sanitization. Deliberately dependency-free (no @workspace/db) — importing
// that package pulls in a directory import Node's ESM loader can't resolve
// without a bundler, which breaks `node --test`; the repo has no Postgres
// provisioning in CI (see ci.yml), so this module's correctness is
// characterization-tested standalone. The
// transactional storage layer lives in crm-files.ts, which re-exports these.

export const FILE_CATEGORIES = z.enum([
  "contract",
  "expansion_contract",
  "cr_certificate",
  "vat_certificate",
  "invoice",
  "payment_proof",
  "other",
]);
export type FileCategory = z.infer<typeof FILE_CATEGORIES>;

// 40 MB: real signed contracts (high-resolution scans) routinely land in the
// tens of MB. Storage headroom isn't the constraint; this purely reflects
// realistic contract sizes.
export const MAX_FILE_SIZE_BYTES = 40 * 1024 * 1024;

export const MAX_FILE_NAME_LENGTH = 255;

/** Content-Disposition is `inline` for these server-canonical mime types. */
export const INLINE_PREVIEWABLE_MIME_TYPES: ReadonlySet<string> = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

export class FileValidationError extends Error {}

/**
 * Builds a Content-Disposition header value with a sanitized filename (R6):
 * quote-escaped ASCII fallback plus an RFC 5987 UTF-8 form for non-ASCII
 * names. fileName is assumed already normalized (no CR/LF/control chars,
 * capped length) by normalizeFileName at storage time.
 */
export function contentDispositionHeader(
  type: "inline" | "attachment",
  fileName: string,
): string {
  const asciiFallback = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, '\\"');
  const encoded = encodeURIComponent(fileName);
  return `${type}; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

function bufferHasPrefixWithin(
  buffer: Buffer,
  needle: Buffer,
  withinBytes: number,
): boolean {
  const scanLength = Math.min(buffer.length, withinBytes);
  return buffer.subarray(0, scanLength).includes(needle);
}

function isZipMagic(buffer: Buffer): boolean {
  // Local file header "PK\x03\x04" — every docx/xlsx (both are zip archives)
  // starts with this; we don't parse the archive contents.
  return (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04
  );
}

/** Exported so callers outside the HTTP upload path (e.g. a data-migration
 * script's extension-correction step) can sniff real file type from bytes
 * without re-declaring these magic-number literals. */
export function isJpegMagic(buffer: Buffer): boolean {
  return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

export function isPngMagic(buffer: Buffer): boolean {
  return (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )
  );
}

interface AllowedType {
  mimeType: string;
  isValidMagic: (buffer: Buffer) => boolean;
}

// Extension → server-canonical mime + magic-byte check. The stored mime_type
// always comes from this map (keyed by extension), never from the client's
// declared MIME — that value is validation input only (R5).
const ALLOWED_TYPES: Record<string, AllowedType> = {
  pdf: {
    mimeType: "application/pdf",
    isValidMagic: (buf) => bufferHasPrefixWithin(buf, Buffer.from("%PDF-"), 1024),
  },
  png: {
    mimeType: "image/png",
    isValidMagic: isPngMagic,
  },
  jpg: {
    mimeType: "image/jpeg",
    isValidMagic: isJpegMagic,
  },
  jpeg: {
    mimeType: "image/jpeg",
    isValidMagic: isJpegMagic,
  },
  webp: {
    mimeType: "image/webp",
    isValidMagic: (buf) =>
      buf.length >= 12 &&
      buf.subarray(0, 4).toString("ascii") === "RIFF" &&
      buf.subarray(8, 12).toString("ascii") === "WEBP",
  },
  docx: {
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    isValidMagic: isZipMagic,
  },
  xlsx: {
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    isValidMagic: isZipMagic,
  },
};

/**
 * Strip directory components, CR/LF and other control characters, and cap
 * length at 255 chars (R6). Unicode is preserved — only ASCII control bytes
 * are stripped. The extension is preserved when truncating the stem, so a
 * long filename still ends up with a recognizable (and validatable) type.
 */
export function normalizeFileName(rawFileName: string): string {
  const base = path.basename(rawFileName.replace(/[/\\]+/g, "/"));
  // eslint-disable-next-line no-control-regex
  const stripped = base.replace(/[\x00-\x1f\x7f]/g, "");
  if (stripped.length <= MAX_FILE_NAME_LENGTH) return stripped;

  const ext = path.extname(stripped);
  const maxStemLength = MAX_FILE_NAME_LENGTH - ext.length;
  if (maxStemLength <= 0) return stripped.slice(0, MAX_FILE_NAME_LENGTH);
  const stem = stripped.slice(0, stripped.length - ext.length);
  return stem.slice(0, maxStemLength) + ext;
}

export interface ValidatedUpload {
  fileName: string;
  mimeType: string;
}

/**
 * Validate an uploaded file: extension allowlist, magic bytes agreeing with
 * the extension, and size. Returns the normalized filename and the
 * server-canonical mime type (derived from the extension allowlist, never
 * from the client's declared MIME, which this function does not take as
 * input — the client's declared type is never trusted or stored).
 */
export function validateUpload(
  buffer: Buffer,
  rawFileName: string,
): ValidatedUpload {
  if (buffer.length === 0) {
    throw new FileValidationError("Empty file.");
  }
  if (buffer.length > MAX_FILE_SIZE_BYTES) {
    throw new FileValidationError(
      `File exceeds the ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB limit.`,
    );
  }

  const fileName = normalizeFileName(rawFileName);
  const ext = path.extname(fileName).slice(1).toLowerCase();
  if (!ext) {
    throw new FileValidationError("File has no extension.");
  }

  const allowed = ALLOWED_TYPES[ext];
  if (!allowed) {
    throw new FileValidationError(`File type ".${ext}" is not allowed.`);
  }
  if (!allowed.isValidMagic(buffer)) {
    throw new FileValidationError(
      "File contents do not match its extension.",
    );
  }

  return { fileName, mimeType: allowed.mimeType };
}

/**
 * Every crm_files row belongs to a deal (a comment attachment also carries
 * noteId). This is the app-layer guard; the NOT NULL column is the backstop.
 */
export function requireValidTarget(dealId: number | null | undefined): void {
  if (dealId == null) {
    throw new FileValidationError("Invalid file target: dealId is required.");
  }
}
