import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
const { parseLogoDataUrl, LogoError, MAX_LOGO_BYTES } = await import("./workspace-logo.ts");

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const url = (type: string, body: Buffer) => `data:${type};base64,${body.toString("base64")}`;

test("a real PNG, JPEG or WebP is accepted", () => {
  assert.equal(parseLogoDataUrl(url("image/png", PNG)), url("image/png", PNG));
  parseLogoDataUrl(url("image/jpeg", Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2])));
  parseLogoDataUrl(url("image/webp", Buffer.from("RIFF\0\0\0\0WEBPVP8 ", "latin1")));
});

test("SVG, other types and non-data URLs are refused", () => {
  assert.throws(() => parseLogoDataUrl(url("image/svg+xml", Buffer.from("<svg/>"))), LogoError);
  assert.throws(() => parseLogoDataUrl(url("text/html", Buffer.from("<b>"))), LogoError);
  assert.throws(() => parseLogoDataUrl("https://example.com/logo.png"), LogoError);
  assert.throws(() => parseLogoDataUrl(42), LogoError);
});

test("a body that isn't the type it claims is refused", () => {
  assert.throws(() => parseLogoDataUrl(url("image/png", Buffer.from("<script>alert(1)</script>"))), /valid/);
});

test("an image over the size cap is refused", () => {
  const big = Buffer.concat([PNG, Buffer.alloc(MAX_LOGO_BYTES)]);
  assert.throws(() => parseLogoDataUrl(url("image/png", big)), /too large/);
});
