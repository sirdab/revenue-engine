import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import type { Request, Response } from "express";
import multer from "multer";
import { fileUploadMulterOptions } from "./file-upload-config.ts";

// Regression guard for the Arabic-filename mojibake bug (Naif, 2026-07-23):
// filenames like "شركة المحبة للتجارة - INVOICE.pdf" rendered as
// "Ø´Ø±ÙØ©…" in the deal Documents card. Cause: multer defaults the plain
// Content-Disposition `filename=` param to latin1, and browsers posting
// FormData send non-ASCII filenames as raw UTF-8 bytes in exactly that param.
// The fix is defParamCharset:"utf8" in fileUploadMulterOptions. No DB here —
// this drives the same multer options routes/files.ts uses (that module can't
// be imported under `node --test` because it pulls in @workspace/db).

const ARABIC_NAME = "شركة المحبة للتجارة - INVOICE.pdf";

// Build a multipart/form-data body the way a browser does: the filename's raw
// UTF-8 bytes sit in the plain `filename=` param (no RFC 5987 `filename*`).
function buildMultipartBody(filename: string): {
  buffer: Buffer;
  contentType: string;
} {
  const boundary = "----filenameEncodingTestBoundary";
  const head =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: application/pdf\r\n\r\n`;
  const body = "%PDF-1.4 test body\n";
  const tail = `\r\n--${boundary}--\r\n`;
  return {
    buffer: Buffer.concat([
      Buffer.from(head, "utf8"),
      Buffer.from(body, "utf8"),
      Buffer.from(tail, "utf8"),
    ]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

function parseOriginalname(
  options: multer.Options,
  filename: string,
): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const { buffer, contentType } = buildMultipartBody(filename);
    // Multer only needs a readable stream carrying the multipart bytes plus the
    // content-type/length headers; it pipes this into busboy.
    const req = Readable.from([buffer]) as Readable & {
      headers: Record<string, string>;
      method: string;
      file?: { originalname: string };
    };
    req.headers = {
      "content-type": contentType,
      "content-length": String(buffer.length),
    };
    req.method = "POST";
    // The mock carries only what multer reads (the stream, headers, method);
    // cast to the Express types the middleware signature wants.
    multer(options).single("file")(
      req as unknown as Request,
      {} as unknown as Response,
      (err: unknown) => {
        if (err) return reject(err);
        resolve(req.file?.originalname);
      },
    );
  });
}

test("upload config decodes an Arabic filename as UTF-8, not mojibake", async () => {
  const originalname = await parseOriginalname(fileUploadMulterOptions, ARABIC_NAME);
  assert.equal(originalname, ARABIC_NAME);
});

test("multer's latin1 default is what produced the mojibake (documents the bug)", async () => {
  // Same body, but with multer's default charset — reproduces the reported
  // corruption, proving defParamCharset:"utf8" is the load-bearing fix.
  const originalname = await parseOriginalname(
    { storage: multer.memoryStorage() },
    ARABIC_NAME,
  );
  assert.notEqual(originalname, ARABIC_NAME);
  assert.match(originalname ?? "", /Ø/);
});

// defParamCharset only governs the plain `filename=` param. The RFC 5987
// `filename*=UTF-8''…` extended form carries its own charset and is decoded by
// that, independent of this setting. A client that sends filename* must still
// come through correctly, so pin that the utf8 setting doesn't disturb it.
test("RFC 5987 filename* form still decodes correctly under the utf8 setting", async () => {
  const boundary = "----filenameStarEncodingTestBoundary";
  const head =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename*=UTF-8''${encodeURIComponent(ARABIC_NAME)}\r\n` +
    `Content-Type: application/pdf\r\n\r\n`;
  const buffer = Buffer.concat([
    Buffer.from(head, "utf8"),
    Buffer.from("%PDF-1.4 test body\n", "utf8"),
    Buffer.from(`\r\n--${boundary}--\r\n`, "utf8"),
  ]);
  const req = Readable.from([buffer]) as Readable & {
    headers: Record<string, string>;
    method: string;
    file?: { originalname: string };
  };
  req.headers = {
    "content-type": `multipart/form-data; boundary=${boundary}`,
    "content-length": String(buffer.length),
  };
  req.method = "POST";
  const originalname = await new Promise<string | undefined>((resolve, reject) => {
    multer(fileUploadMulterOptions).single("file")(
      req as unknown as Request,
      {} as unknown as Response,
      (err: unknown) => {
        if (err) return reject(err);
        resolve(req.file?.originalname);
      },
    );
  });
  assert.equal(originalname, ARABIC_NAME);
});
