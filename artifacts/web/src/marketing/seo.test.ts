import test from "node:test";
import assert from "node:assert/strict";
import { ar } from "./content/ar.ts";
import { en } from "./content/en.ts";
import type { Content } from "./content/types.ts";
import { headTags, llmsTxt, plain, robotsTxt, sitemapXml } from "./seo.ts";
import { LOCALES, ORIGIN_TOKEN, PAGES, ROUTES, matchRoute, pagePath } from "./site.ts";

const CONTENT: Record<(typeof LOCALES)[number], Content> = { en, ar };

const metaOf = (c: Content, page: (typeof PAGES)[number]) =>
  page === "home" ? c.home.meta : c.guides[page].meta;

test("every page exists in every language, at a path of its own", () => {
  assert.equal(ROUTES.length, PAGES.length * LOCALES.length);
  assert.equal(new Set(ROUTES.map((r) => r.path)).size, ROUTES.length);
  assert.equal(new Set(ROUTES.map((r) => r.file)).size, ROUTES.length);
  assert.equal(pagePath("home", "en"), "/");
  assert.equal(pagePath("home", "ar"), "/ar");
  assert.equal(pagePath("self-hosted-crm", "ar"), "/ar/self-hosted-crm");
});

test("routes are found with or without a trailing slash, and nothing else is", () => {
  for (const route of ROUTES) {
    assert.equal(matchRoute(route.path), route);
    if (route.path !== "/") assert.equal(matchRoute(`${route.path}/`), route);
  }
  for (const p of ["/login", "/signup", "/home", "/AR", "/ar/nope", "/open-source-crm/x"]) {
    assert.equal(matchRoute(p), undefined, p);
  }
});

test("only the two home pages send a signed-in visitor into the app", () => {
  for (const route of ROUTES) {
    assert.equal(route.redirectSignedInTo, route.page === "home" ? "/home" : undefined, route.path);
  }
});

// Search results cut a title near 60 characters and a description near 160.
// A page that runs long is rewritten by the search engine, usually badly.
test("titles and descriptions fit what a search result shows", () => {
  for (const locale of LOCALES) {
    for (const page of PAGES) {
      const { title, description, imageAlt } = metaOf(CONTENT[locale], page);
      const where = `${locale}/${page}`;
      assert.ok(title.length >= 30 && title.length <= 65, `${where} title is ${title.length} chars`);
      assert.ok(
        description.length >= 110 && description.length <= 165,
        `${where} description is ${description.length} chars`,
      );
      assert.ok(imageAlt.length > 10, `${where} needs share-image alt text`);
    }
  }
});

test("no two pages compete with the same title or description", () => {
  for (const locale of LOCALES) {
    const metas = PAGES.map((page) => metaOf(CONTENT[locale], page));
    assert.equal(new Set(metas.map((m) => m.title)).size, PAGES.length, locale);
    assert.equal(new Set(metas.map((m) => m.description)).size, PAGES.length, locale);
  }
});

test("each page's head names itself as canonical and lists every language", () => {
  for (const route of ROUTES) {
    const head = headTags(CONTENT[route.locale], route);
    assert.ok(
      head.includes(`<link rel="canonical" href="${ORIGIN_TOKEN}${route.path}" />`),
      route.path,
    );
    for (const locale of LOCALES) {
      const alt = `hreflang="${locale}" href="${ORIGIN_TOKEN}${pagePath(route.page, locale)}"`;
      assert.ok(head.includes(alt), `${route.path} is missing ${alt}`);
    }
    assert.ok(head.includes(`hreflang="x-default" href="${ORIGIN_TOKEN}${pagePath(route.page, "en")}"`));
    assert.ok(head.includes('content="index, follow'), `${route.path} must be indexable`);
    assert.equal(head.match(/<title>/g)?.length, 1);
  }
});

test("structured data is valid JSON, describes a free product, and answers the FAQ", () => {
  for (const route of ROUTES) {
    const head = headTags(CONTENT[route.locale], route);
    const json = /<script type="application\/ld\+json">(.*?)<\/script>/s.exec(head)?.[1];
    assert.ok(json, route.path);
    const graph = JSON.parse(json)["@graph"] as { "@type": string; [k: string]: unknown }[];
    const types = graph.map((node) => node["@type"]);
    for (const type of ["Organization", "WebSite", "SoftwareApplication", "WebPage", "FAQPage"]) {
      assert.ok(types.includes(type), `${route.path} is missing ${type}`);
    }
    assert.equal(types.includes("BreadcrumbList"), route.page !== "home", route.path);
    const app = graph.find((node) => node["@type"] === "SoftwareApplication")!;
    assert.deepEqual((app.offers as { price: string }).price, "0");
    // Ratings and reviews are never invented.
    assert.ok(!("aggregateRating" in app) && !("review" in app));
    const faq = graph.find((node) => node["@type"] === "FAQPage")!;
    for (const q of faq.mainEntity as { name: string; acceptedAnswer: { text: string } }[]) {
      assert.ok(q.name && q.acceptedAnswer.text);
      // Plain text only: no leftover markup from the copy.
      assert.ok(!/\*\*|\]\(|`/.test(q.acceptedAnswer.text), q.acceptedAnswer.text);
    }
  }
});

test("the sitemap lists every page once, with its translations", () => {
  const xml = sitemapXml();
  assert.equal(xml.match(/<url>/g)?.length, ROUTES.length);
  for (const route of ROUTES) {
    assert.ok(xml.includes(`<loc>${ORIGIN_TOKEN}${route.path}</loc>`), route.path);
  }
  assert.equal(xml.match(/hreflang="x-default"/g)?.length, ROUTES.length);
  assert.ok(!xml.includes("/login") && !xml.includes("/signup"));
});

test("robots.txt points at the sitemap and keeps crawlers out of the API only", () => {
  const robots = robotsTxt();
  assert.ok(robots.includes(`Sitemap: ${ORIGIN_TOKEN}/sitemap.xml`));
  assert.deepEqual(
    robots.split("\n").filter((line) => line.startsWith("Disallow:")),
    ["Disallow: /api/"],
  );
});

test("llms.txt links every page", () => {
  const text = llmsTxt(en);
  assert.ok(text.startsWith("# Revenue Engine\n"));
  for (const page of PAGES) {
    assert.ok(text.includes(`(${ORIGIN_TOKEN}${pagePath(page, "en")})`), page);
  }
});

test("plain() strips the copy's inline markup", () => {
  assert.equal(plain("**Bold** and [a link](github) and `code`."), "Bold and a link and code.");
});
