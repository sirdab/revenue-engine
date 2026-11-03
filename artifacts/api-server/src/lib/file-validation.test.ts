import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FILE_CATEGORIES,
  MAX_FILE_SIZE_BYTES,
  MAX_FILE_NAME_LENGTH,
  FileValidationError,
  normalizeFileName,
  validateUpload,
  requireValidTarget,
  contentDispositionHeader,
} from "./file-validation.ts";

// Characterization of the upload-hardening core (R5, R6): extension
// allowlist, magic-byte agreement, filename sanitization. No DB access — the
// repo's `node --test` suite has no Postgres provisioning (see ci.yml), so
// the transactional save/get/delete round-trip (R4, R8) is verified manually
// against a real deal/account in dev, same as the router in U3.

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

function pdfBuffer(offset: number, totalLength: number): Buffer {
  const buf = Buffer.alloc(totalLength, 0x20);
  Buffer.from("%PDF-1.4").copy(buf, offset);
  return buf;
}

function webpBuffer(): Buffer {
  const buf = Buffer.alloc(16);
  buf.write("RIFF", 0, "ascii");
  buf.write("WEBP", 8, "ascii");
  return buf;
}

// --- validateUpload: happy paths -------------------------------------------

test("valid PDF with %PDF- at byte 0 passes and returns canonical mime", () => {
  const result = validateUpload(pdfBuffer(0, 100), "contract.pdf");
  assert.equal(result.mimeType, "application/pdf");
  assert.equal(result.fileName, "contract.pdf");
});

test("valid PNG passes and returns canonical mime", () => {
  const buf = Buffer.concat([PNG_MAGIC, Buffer.alloc(20)]);
  const result = validateUpload(buf, "logo.png");
  assert.equal(result.mimeType, "image/png");
});

test("valid JPEG passes", () => {
  const buf = Buffer.concat([JPEG_MAGIC, Buffer.alloc(20)]);
  const result = validateUpload(buf, "photo.jpg");
  assert.equal(result.mimeType, "image/jpeg");
});

test("valid WEBP passes", () => {
  const result = validateUpload(webpBuffer(), "photo.webp");
  assert.equal(result.mimeType, "image/webp");
});

test("valid docx (zip magic) passes", () => {
  const buf = Buffer.concat([ZIP_MAGIC, Buffer.alloc(20)]);
  const result = validateUpload(buf, "contract.docx");
  assert.equal(
    result.mimeType,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
});

test("valid xlsx (zip magic) passes", () => {
  const buf = Buffer.concat([ZIP_MAGIC, Buffer.alloc(20)]);
  const result = validateUpload(buf, "invoice.xlsx");
  assert.equal(
    result.mimeType,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
});

// --- validateUpload: edge cases ---------------------------------------------

test("%PDF- at offset 500 (within 1024-byte scan) passes", () => {
  const result = validateUpload(pdfBuffer(500, 1200), "contract.pdf");
  assert.equal(result.mimeType, "application/pdf");
});

test("%PDF- at offset 2000 (outside 1024-byte scan) fails", () => {
  assert.throws(
    () => validateUpload(pdfBuffer(2000, 2100), "contract.pdf"),
    FileValidationError,
  );
});

test("empty buffer fails", () => {
  assert.throws(() => validateUpload(Buffer.alloc(0), "file.pdf"));
});

test("filename with no extension fails", () => {
  assert.throws(() => validateUpload(pdfBuffer(0, 50), "contract"));
});

test("MAX_FILE_SIZE_BYTES + 1 byte rejected by the size guard", () => {
  const buf = pdfBuffer(0, MAX_FILE_SIZE_BYTES + 1);
  assert.throws(() => validateUpload(buf, "contract.pdf"));
});

test("exactly MAX_FILE_SIZE_BYTES is accepted", () => {
  const buf = pdfBuffer(0, MAX_FILE_SIZE_BYTES);
  assert.doesNotThrow(() => validateUpload(buf, "contract.pdf"));
});

test("unicode filename is preserved", () => {
  const result = validateUpload(pdfBuffer(0, 50), "عقد.pdf");
  assert.equal(result.fileName, "عقد.pdf");
});

test("hostile filename (CRLF, quote, path traversal) is stored normalized", () => {
  const result = validateUpload(pdfBuffer(0, 50), '../../etc/evil\r\n".pdf');
  assert.ok(!result.fileName.includes("\r"));
  assert.ok(!result.fileName.includes("\n"));
  assert.ok(!result.fileName.includes("/"));
  assert.ok(!result.fileName.includes(".."));
});

test("filename longer than 255 chars is capped and keeps its extension", () => {
  const longName = "a".repeat(300) + ".pdf";
  const result = validateUpload(pdfBuffer(0, 50), longName);
  assert.ok(result.fileName.length <= MAX_FILE_NAME_LENGTH);
  assert.ok(result.fileName.endsWith(".pdf"));
});

test("normalizeFileName: extension itself >= 255 chars falls back to a flat cap", () => {
  const hugeExt = "." + "a".repeat(300);
  const result = normalizeFileName("name" + hugeExt);
  assert.equal(result.length, MAX_FILE_NAME_LENGTH);
});

// --- validateUpload: error paths --------------------------------------------

test("non-PDF bytes named .pdf fail (magic bytes disagree with extension)", () => {
  const buf = Buffer.from("not a pdf at all, just text padding".repeat(5));
  assert.throws(() => validateUpload(buf, "contract.pdf"));
});

test("valid PNG bytes named x.pdf fails (extension-vs-magic mismatch)", () => {
  const buf = Buffer.concat([PNG_MAGIC, Buffer.alloc(20)]);
  assert.throws(() => validateUpload(buf, "x.pdf"));
});

for (const ext of ["svg", "html", "exe"]) {
  test(`disallowed extension .${ext} fails regardless of bytes`, () => {
    assert.throws(() =>
      validateUpload(pdfBuffer(0, 50), `file.${ext}`),
    );
  });
}

test("category outside the enum fails", () => {
  const result = FILE_CATEGORIES.safeParse("not_a_real_category");
  assert.equal(result.success, false);
});

test("category from the enum is accepted", () => {
  const result = FILE_CATEGORIES.safeParse("contract");
  assert.equal(result.success, true);
});

// --- contentDispositionHeader -------------------------------------------------

test("contentDispositionHeader: inline type is reflected verbatim", () => {
  const header = contentDispositionHeader("inline", "contract.pdf");
  assert.match(header, /^inline;/);
});

test("contentDispositionHeader: attachment type is reflected verbatim", () => {
  const header = contentDispositionHeader("attachment", "sheet.xlsx");
  assert.match(header, /^attachment;/);
});

test("contentDispositionHeader: quote in filename is escaped in the ASCII fallback", () => {
  const header = contentDispositionHeader("inline", 'a"b.pdf');
  assert.match(header, /filename="a\\"b\.pdf"/);
});

test("contentDispositionHeader: non-ASCII filename gets an RFC 5987 filename* fallback", () => {
  const header = contentDispositionHeader("inline", "عقد.pdf");
  assert.match(header, /filename\*=UTF-8''%D8%B9%D9%82%D8%AF\.pdf/);
});

// requireValidTarget — every file belongs to a deal.
test("requireValidTarget: accepts a deal", () => {
  assert.doesNotThrow(() => requireValidTarget(1));
});

test("requireValidTarget: rejects a missing deal", () => {
  assert.throws(() => requireValidTarget(null), FileValidationError);
  assert.throws(() => requireValidTarget(undefined), FileValidationError);
});
