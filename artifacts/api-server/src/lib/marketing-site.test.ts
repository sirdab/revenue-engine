import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  loadMarketingSite,
  publicOrigin,
  resolveMarketingRequest,
  type MarketingSite,
} from "./marketing-site.ts";

const TOKEN = "__SITE_ORIGIN__";

/** A marketing build on disk, the way the web build leaves it. */
function buildSite(): { dir: string; site: MarketingSite } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "marketing-site-"));
  fs.mkdirSync(path.join(dir, "en"));
  fs.mkdirSync(path.join(dir, "ar"));
  fs.writeFileSync(
    path.join(dir, "en/home.html"),
    `<link rel="canonical" href="${TOKEN}/"><a href="${TOKEN}/ar">ar</a> costs $0`,
  );
  fs.writeFileSync(path.join(dir, "ar/home.html"), `<link rel="canonical" href="${TOKEN}/ar">`);
  fs.writeFileSync(path.join(dir, "en/guide.html"), `<link rel="canonical" href="${TOKEN}/guide">`);
  fs.writeFileSync(path.join(dir, "sitemap.xml"), `<loc>${TOKEN}/</loc><loc>${TOKEN}/ar</loc>`);
  fs.writeFileSync(path.join(dir, "robots.txt"), `Sitemap: ${TOKEN}/sitemap.xml\n`);
  fs.writeFileSync(
    path.join(dir, "manifest.json"),
    JSON.stringify({
      version: 1,
      originToken: TOKEN,
      pages: [
        { path: "/", file: "en/home.html", redirectSignedInTo: "/home" },
        { path: "/ar", file: "ar/home.html", redirectSignedInTo: "/home" },
        { path: "/guide", file: "en/guide.html" },
      ],
      files: [
        { path: "/sitemap.xml", file: "sitemap.xml", contentType: "application/xml; charset=utf-8" },
        { path: "/robots.txt", file: "robots.txt", contentType: "text/plain; charset=utf-8" },
      ],
    }),
  );
  const site = loadMarketingSite(dir);
  assert.ok(site);
  return { dir, site };
}

const { dir, site } = buildSite();
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

const get = (p: string, extra: Partial<{ hasSession: boolean; origin: string; method: string }> = {}) =>
  resolveMarketingRequest(site, {
    method: "GET",
    path: p,
    hasSession: false,
    origin: "https://crm.example.com",
    ...extra,
  });

test("a folder with no manifest is not a marketing site", () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "marketing-none-"));
  try {
    assert.equal(loadMarketingSite(empty), null);
    assert.equal(loadMarketingSite(path.join(empty, "missing")), null);
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }
});

test("a manifest naming a missing file fails loudly", () => {
  const broken = fs.mkdtempSync(path.join(os.tmpdir(), "marketing-broken-"));
  try {
    fs.writeFileSync(
      path.join(broken, "manifest.json"),
      JSON.stringify({
        version: 1,
        originToken: TOKEN,
        pages: [{ path: "/", file: "en/home.html" }],
        files: [],
      }),
    );
    assert.throws(() => loadMarketingSite(broken));
  } finally {
    fs.rmSync(broken, { recursive: true, force: true });
  }
});

test("a page is served with every origin token filled in", () => {
  const res = get("/");
  assert.ok(res && res.kind === "body");
  assert.equal(res.contentType, "text/html; charset=utf-8");
  assert.equal(
    res.body,
    '<link rel="canonical" href="https://crm.example.com/"><a href="https://crm.example.com/ar">ar</a> costs $0',
  );
  assert.ok(!res.body.includes(TOKEN));
  // Revalidated every time: the same URL redirects a signed-in visitor.
  assert.equal(res.cacheControl, "no-cache");
  assert.equal(res.variesByCookie, true);
});

test("the origin follows the request, so one build serves any domain", () => {
  const res = get("/ar", { origin: "http://localhost:8080" });
  assert.ok(res && res.kind === "body");
  assert.equal(res.body, '<link rel="canonical" href="http://localhost:8080/ar">');
});

test("a signed-in visitor is sent from the home pages into the app", () => {
  for (const p of ["/", "/ar"]) {
    assert.deepEqual(get(p, { hasSession: true }), {
      kind: "redirect",
      status: 302,
      location: "/home",
    });
  }
});

test("other pages are worth reading signed in or not", () => {
  const res = get("/guide", { hasSession: true });
  assert.ok(res && res.kind === "body");
  assert.equal(res.variesByCookie, false);
});

test("a trailing slash redirects permanently to the one true URL", () => {
  assert.deepEqual(get("/ar/"), { kind: "redirect", status: 301, location: "/ar" });
  assert.deepEqual(get("/guide//"), { kind: "redirect", status: 301, location: "/guide" });
  // Not for paths that are not ours: those belong to the app.
  assert.equal(get("/deals/"), null);
});

test("sitemap and robots carry the public origin and may be cached", () => {
  const sitemap = get("/sitemap.xml");
  assert.ok(sitemap && sitemap.kind === "body");
  assert.equal(sitemap.contentType, "application/xml; charset=utf-8");
  assert.equal(
    sitemap.body,
    "<loc>https://crm.example.com/</loc><loc>https://crm.example.com/ar</loc>",
  );
  assert.equal(sitemap.cacheControl, "public, max-age=3600");

  const robots = get("/robots.txt", { hasSession: true });
  assert.ok(robots && robots.kind === "body");
  assert.equal(robots.body, "Sitemap: https://crm.example.com/sitemap.xml\n");
});

test("everything else falls through to the app", () => {
  for (const p of ["/home", "/login", "/signup", "/deals", "/api/healthz", "/assets/x.js", "/AR"]) {
    assert.equal(get(p), null, p);
  }
});

test("only GET and HEAD are answered", () => {
  assert.ok(get("/", { method: "HEAD" }));
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    assert.equal(get("/", { method }), null, method);
  }
});

test("APP_BASE_URL wins over the request's host", () => {
  const req = { protocol: "http", host: "internal:8080" };
  assert.equal(publicOrigin("https://crm.example.com", req), "https://crm.example.com");
  assert.equal(publicOrigin("https://crm.example.com/", req), "https://crm.example.com");
  assert.equal(publicOrigin(" ", req), "http://internal:8080");
  assert.equal(publicOrigin(undefined, { protocol: "https", host: "a.fly.dev" }), "https://a.fly.dev");
});

test("a Host header that is not a host never reaches the page", () => {
  for (const host of [
    'evil.com"><script>alert(1)</script>',
    "evil.com/path",
    "a b",
    "",
    undefined,
    "user@evil.com",
  ]) {
    assert.equal(publicOrigin(undefined, { protocol: "https", host }), "", String(host));
  }
});
