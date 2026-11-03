import test from "node:test";
import assert from "node:assert/strict";
import { shouldServeSpaShell } from "./spa-fallback";

// Regression: REVENUE-ENGINE-7 / REVENUE-ENGINE-P.
//
// After a deploy, a browser still holding the previous index.html requests a
// content-hashed chunk that no longer exists. express.static misses, and the
// SPA fallback used to answer with index.html — a 200 of text/html where the
// browser expected JavaScript, which Safari reports as
// "'text/html' is not a valid JavaScript MIME type." A miss under /assets/ is
// always a stale reference, so it must 404 instead.

test("stale hashed asset requests do not get the SPA shell", () => {
  assert.equal(
    shouldServeSpaShell("/assets/vendor-router-query-BMEprGk-.js", "GET"),
    false,
  );
  assert.equal(shouldServeSpaShell("/assets/index-DQKyYO1A.css", "GET"), false);
  assert.equal(shouldServeSpaShell("/assets/logo-a1b2c3.svg", "GET"), false);
});

test("asset-shaped requests outside /assets/ do not get the SPA shell", () => {
  for (const p of [
    "/favicon.ico",
    "/robots.txt",
    "/sw.js",
    "/fonts/inter.woff2",
    "/index-abc.js.map",
  ]) {
    assert.equal(shouldServeSpaShell(p, "GET"), false, p);
  }
});

test("real SPA navigations still get the shell", () => {
  for (const p of [
    "/",
    "/accounts/4036",
    "/quotes",
    "/deals/123",
    "/admin/settings",
    "/not-a-real-route",
  ]) {
    assert.equal(shouldServeSpaShell(p, "GET"), true, p);
  }
});

test("a route segment containing a dot is still a navigation", () => {
  // Names and search terms can contain dots; only *known asset* extensions
  // should be excluded, not every path with a "." in it.
  assert.equal(shouldServeSpaShell("/search/acme.co", "GET"), true);
  assert.equal(shouldServeSpaShell("/contacts/jane.doe", "GET"), true);
});

test("HEAD navigations get the shell, other methods never do", () => {
  assert.equal(shouldServeSpaShell("/quotes", "HEAD"), true);
  for (const m of ["POST", "PUT", "PATCH", "DELETE"]) {
    assert.equal(shouldServeSpaShell("/quotes", m), false, m);
  }
});

test("API paths never get the shell", () => {
  assert.equal(shouldServeSpaShell("/api/notifications", "GET"), false);
  assert.equal(shouldServeSpaShell("/api/unknown", "GET"), false);
});
