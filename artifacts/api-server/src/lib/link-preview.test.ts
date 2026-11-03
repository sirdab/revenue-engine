import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractPreviewUrls,
  isGlobalUnicastAddress,
  validateUrlShape,
  MAX_URLS_PER_COMMENT,
} from "./link-preview-validation.ts";

// The SSRF layer's pure core (R11). No DB, no network — CI-runnable. The
// impure fetch/redirect path is verified manually in dev.

// --- extractPreviewUrls -----------------------------------------------------

test("extractPreviewUrls: pulls http(s) anchor hrefs, decodes &amp;", () => {
  const html = `<p>see <a href="https://example.com/a?x=1&amp;y=2">link</a></p>`;
  assert.deepEqual(extractPreviewUrls(html), ["https://example.com/a?x=1&y=2"]);
});

test("extractPreviewUrls: ignores non-http schemes and dedupes", () => {
  const html = `<a href="mailto:x@y.com">m</a><a href="https://a.com">1</a><a href="https://a.com">2</a>`;
  assert.deepEqual(extractPreviewUrls(html), ["https://a.com"]);
});

test("extractPreviewUrls: caps at the first N and skips >2000-char URLs", () => {
  const long = "https://a.com/" + "x".repeat(2100);
  const many = Array.from({ length: 6 }, (_, i) => `<a href="https://s${i}.com">l</a>`).join("");
  assert.equal(extractPreviewUrls(many).length, MAX_URLS_PER_COMMENT);
  assert.deepEqual(extractPreviewUrls(`<a href="${long}">l</a>`), []);
});

test("extractPreviewUrls: empty / null → []", () => {
  assert.deepEqual(extractPreviewUrls(null), []);
  assert.deepEqual(extractPreviewUrls("<p>no links</p>"), []);
});

// --- isGlobalUnicastAddress: rejects private/special --------------------------

for (const ip of [
  "127.0.0.1", // loopback
  "10.0.0.5", // private
  "172.16.0.1", // private
  "192.168.1.1", // private
  "169.254.169.254", // link-local (cloud metadata)
  "100.64.0.1", // CGNAT
  "0.0.0.0", // this-network
  "255.255.255.255", // broadcast
  "224.0.0.1", // multicast
  "::1", // IPv6 loopback
  "::", // unspecified
  "fe80::1", // link-local
  "fc00::1", // ULA
  "fdaa::1", // Fly 6PN (fd00::/8 ULA)
  "::ffff:127.0.0.1", // IPv4-mapped loopback
  "::ffff:169.254.169.254", // IPv4-mapped metadata
  "64:ff9b::7f00:1", // NAT64 → 127.0.0.1
  "ff02::1", // multicast
  "not-an-ip",
]) {
  test(`isGlobalUnicastAddress rejects ${ip}`, () => {
    assert.equal(isGlobalUnicastAddress(ip), false);
  });
}

// --- isGlobalUnicastAddress: allows genuine public --------------------------

for (const ip of [
  "93.184.216.34", // example.com
  "1.1.1.1", // Cloudflare
  "8.8.8.8", // Google DNS
  "2606:2800:220:1:248:1893:25c8:1946", // example.com IPv6
  "2001:4860:4860::8888", // Google DNS IPv6
]) {
  test(`isGlobalUnicastAddress allows ${ip}`, () => {
    assert.equal(isGlobalUnicastAddress(ip), true);
  });
}

// --- validateUrlShape -------------------------------------------------------

test("validateUrlShape: accepts http/https on 80/443, rejects other schemes/ports", () => {
  assert.ok(validateUrlShape("https://example.com/x"));
  assert.ok(validateUrlShape("http://example.com:80/x"));
  assert.equal(validateUrlShape("ftp://example.com"), null);
  assert.equal(validateUrlShape("file:///etc/passwd"), null);
  assert.equal(validateUrlShape("https://example.com:8080/x"), null);
  assert.equal(validateUrlShape("javascript:alert(1)"), null);
});

test("validateUrlShape: denies the app's own public origin", () => {
  const app = "https://crm.example.com";
  assert.equal(validateUrlShape("https://crm.example.com/internal", app), null);
  assert.ok(validateUrlShape("https://example.com/x", app));
});

// SSRF regression: Node's connect skips the custom DNS lookup for IP-literal
// hosts, so validateUrlShape must classify literal hosts itself. This is the
// exact bypass that a DNS-hook-only check misses.
for (const u of [
  "http://127.0.0.1/",
  "http://169.254.169.254/", // cloud metadata
  "http://10.0.0.5/",
  "http://[::1]/",
  "http://[fd00::1]/", // ULA (Fly 6PN family)
  "http://[::127.0.0.1]/", // IPv4-compatible → loopback
  "http://[::ffff:169.254.169.254]/", // IPv4-mapped → metadata
  "https://[fe80::1]/", // link-local
]) {
  test(`validateUrlShape rejects internal IP literal ${u}`, () => {
    assert.equal(validateUrlShape(u), null);
  });
}

test("validateUrlShape allows a public IP literal", () => {
  assert.ok(validateUrlShape("http://1.1.1.1/"));
  assert.ok(validateUrlShape("https://[2001:4860:4860::8888]/"));
});

// IPv6 embedded-IPv4 forms that must resolve to their private embedded address.
for (const ip of [
  "::127.0.0.1", // IPv4-compatible loopback
  "::10.0.0.1", // IPv4-compatible private
  "2002:7f00:1::", // 6to4 embedding 127.0.0.1
  "2002:a00:1::", // 6to4 embedding 10.0.0.1
  "2001:0:0:0:0:0:0:1", // Teredo 2001:0000::/32
]) {
  test(`isGlobalUnicastAddress rejects embedded-IPv4 form ${ip}`, () => {
    assert.equal(isGlobalUnicastAddress(ip), false);
  });
}

test("isGlobalUnicastAddress: 2001:4860:... is NOT Teredo (allowed)", () => {
  assert.equal(isGlobalUnicastAddress("2001:4860:4860::8888"), true);
});

test("validateUrlShape strips URL-embedded credentials", () => {
  const shape = validateUrlShape("http://user:pass@example.com/x");
  assert.ok(shape);
  assert.ok(!shape!.href.includes("user"));
  assert.ok(!shape!.href.includes("pass"));
});
