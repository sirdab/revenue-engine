import test from "node:test";
import assert from "node:assert/strict";
import { canonicalRedirect } from "./canonical-host";

const BASE = "https://crm.example.com";
const req = (originalUrl: string, host = "my-app.fly.dev", method = "GET") => ({ method, host, originalUrl });

test("a page on *.fly.dev goes to the same path on APP_BASE_URL", () => {
  assert.equal(canonicalRedirect(BASE, req("/ar")), "https://crm.example.com/ar");
  assert.equal(canonicalRedirect(`${BASE}/`, req("/?lang=ar")), "https://crm.example.com/?lang=ar");
  assert.equal(canonicalRedirect(BASE, req("/sitemap.xml", "MY-APP.fly.dev:443", "HEAD")), "https://crm.example.com/sitemap.xml");
});

test("API calls, writes, other hosts and an unset base are served where they land", () => {
  assert.equal(canonicalRedirect(BASE, req("/api/healthz")), null);
  assert.equal(canonicalRedirect(BASE, req("/api")), null);
  assert.equal(canonicalRedirect(BASE, req("/login", "my-app.fly.dev", "POST")), null);
  assert.equal(canonicalRedirect(BASE, req("/", "crm.example.com")), null);
  assert.equal(canonicalRedirect(BASE, req("/", "10.0.0.5:8080")), null);
  assert.equal(canonicalRedirect(undefined, req("/")), null);
  // A base that is itself the fly.dev host never loops.
  assert.equal(canonicalRedirect("https://my-app.fly.dev", req("/")), null);
});
