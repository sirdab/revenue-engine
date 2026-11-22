// What a crawler reads: the <head> of each page, its structured data, and the
// three site files (sitemap.xml, robots.txt, llms.txt).
//
// Absolute URLs use ORIGIN_TOKEN; the server fills in the real origin when it
// serves the page, so the same build is correct on any domain.

import type { Content, Faq, Guide } from "./content/types";
import {
  DEFAULT_LOCALE,
  HOSTED_PRICE,
  LOCALES,
  LOCALE_META,
  ORIGIN_TOKEN,
  PAGES,
  ROUTES,
  SITE,
  pagePath,
  pageUrl,
  repoFile,
  type Locale,
  type PageId,
  type Route,
} from "./site";

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Copy with its inline markup removed, for meta tags and structured data. */
export const plain = (s: string): string =>
  s
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1");

/** The share image, one per language (public/og-<locale>.jpg, 1200×630). */
export const shareImage = (locale: Locale): string => `${ORIGIN_TOKEN}/og-${locale}.jpg`;

const ORG_ID = `${ORIGIN_TOKEN}/#organization`;
const SITE_ID = `${ORIGIN_TOKEN}/#website`;
const APP_ID = `${ORIGIN_TOKEN}/#software`;
const MIT_URL = "https://opensource.org/licenses/MIT";

function meta(c: Content, page: PageId) {
  return page === "home" ? c.home.meta : c.guides[page].meta;
}

function faqNode(faq: Faq[], url: string) {
  return {
    "@type": "FAQPage",
    "@id": `${url}#faq`,
    mainEntity: faq.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a.map(plain).join(" ") },
    })),
  };
}

function structuredData(c: Content, route: Route): object {
  const { page, locale } = route;
  const url = pageUrl(page, locale);
  const m = meta(c, page);
  const lang = LOCALE_META[locale].htmlLang;
  // The pages are rebuilt with every deploy; that is when they last changed.
  const built = new Date().toISOString().slice(0, 10);

  const graph: object[] = [
    {
      "@type": "Organization",
      "@id": ORG_ID,
      name: SITE.company,
      url: SITE.companyUrl,
      sameAs: [SITE.githubUrl.replace(/\/[^/]+$/, "")],
    },
    {
      "@type": "WebSite",
      "@id": SITE_ID,
      name: SITE.name,
      url: `${ORIGIN_TOKEN}/`,
      inLanguage: LOCALES.map((l) => LOCALE_META[l].htmlLang),
      publisher: { "@id": ORG_ID },
    },
    {
      "@type": "SoftwareApplication",
      "@id": APP_ID,
      name: SITE.name,
      description: c.home.meta.description,
      url: `${ORIGIN_TOKEN}/`,
      applicationCategory: "BusinessApplication",
      applicationSubCategory: "Customer relationship management",
      operatingSystem: "Web",
      inLanguage: LOCALES.map((l) => LOCALE_META[l].htmlLang),
      license: MIT_URL,
      // The hosted plan, billed once a year per seat after the free months.
      // Self-hosting the MIT-licensed code is free and is the SoftwareSourceCode below.
      offers: {
        "@type": "Offer",
        price: HOSTED_PRICE.perSeatYear,
        priceCurrency: HOSTED_PRICE.currency,
        priceSpecification: {
          "@type": "UnitPriceSpecification",
          price: HOSTED_PRICE.perSeatYear,
          priceCurrency: HOSTED_PRICE.currency,
          unitText: "seat",
          billingDuration: "P1Y",
        },
        eligibleDuration: { "@type": "QuantitativeValue", value: HOSTED_PRICE.freeMonths, unitCode: "MON" },
        availability: "https://schema.org/InStock",
        url: `${ORIGIN_TOKEN}/signup`,
      },
      featureList: c.home.product.jobs.map((job) => `${job.nav}: ${job.rest}`),
      screenshot: shareImage(locale),
      image: shareImage(locale),
      author: { "@id": ORG_ID },
      publisher: { "@id": ORG_ID },
    },
    {
      "@type": "SoftwareSourceCode",
      "@id": `${ORIGIN_TOKEN}/#source`,
      name: SITE.name,
      codeRepository: SITE.githubUrl,
      programmingLanguage: "TypeScript",
      runtimePlatform: "Node.js",
      license: MIT_URL,
      targetProduct: { "@id": APP_ID },
      author: { "@id": ORG_ID },
    },
    {
      "@type": "WebPage",
      "@id": `${url}#webpage`,
      url,
      name: m.title,
      description: m.description,
      inLanguage: lang,
      dateModified: built,
      isPartOf: { "@id": SITE_ID },
      about: { "@id": APP_ID },
      primaryImageOfPage: { "@type": "ImageObject", url: shareImage(locale) },
    },
  ];

  if (page === "home") {
    graph.push(faqNode(c.home.faq.items, url));
  } else {
    const guide: Guide = c.guides[page];
    graph.push(faqNode(guide.faq, url), {
      "@type": "BreadcrumbList",
      "@id": `${url}#breadcrumb`,
      itemListElement: [
        { "@type": "ListItem", position: 1, name: c.common.home, item: pageUrl("home", locale) },
        { "@type": "ListItem", position: 2, name: guide.name, item: url },
      ],
    });
  }
  return { "@context": "https://schema.org", "@graph": graph };
}

/** Everything that goes in <head> for one page, as an HTML string. */
export function headTags(c: Content, route: Route): string {
  const { page, locale } = route;
  const m = meta(c, page);
  const url = pageUrl(page, locale);
  const image = shareImage(locale);
  const alternates = LOCALES.map(
    (l) => `<link rel="alternate" hreflang="${LOCALE_META[l].htmlLang}" href="${pageUrl(page, l)}" />`,
  );
  const otherOg = LOCALES.filter((l) => l !== locale).map(
    (l) => `<meta property="og:locale:alternate" content="${LOCALE_META[l].ogLocale}" />`,
  );
  // "<" would end the script element early; "<" is the same character to JSON.
  const ld = JSON.stringify(structuredData(c, route)).replace(/</g, "\\u003c");

  return [
    `<title>${esc(m.title)}</title>`,
    `<meta name="description" content="${esc(m.description)}" />`,
    `<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1" />`,
    `<link rel="canonical" href="${url}" />`,
    ...alternates,
    `<link rel="alternate" hreflang="x-default" href="${pageUrl(page, DEFAULT_LOCALE)}" />`,
    `<meta name="application-name" content="${esc(SITE.name)}" />`,
    `<meta name="theme-color" content="#f5f6f1" />`,
    `<meta name="color-scheme" content="light" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${esc(SITE.name)}" />`,
    `<meta property="og:title" content="${esc(m.title)}" />`,
    `<meta property="og:description" content="${esc(m.description)}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:locale" content="${LOCALE_META[locale].ogLocale}" />`,
    ...otherOg,
    `<meta property="og:image" content="${image}" />`,
    `<meta property="og:image:type" content="image/jpeg" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${esc(m.imageAlt)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(m.title)}" />`,
    `<meta name="twitter:description" content="${esc(m.description)}" />`,
    `<meta name="twitter:image" content="${image}" />`,
    `<meta name="twitter:image:alt" content="${esc(m.imageAlt)}" />`,
    `<link rel="alternate" type="text/plain" href="/llms.txt" title="llms.txt" />`,
    `<script type="application/ld+json">${ld}</script>`,
  ].join("\n    ");
}

// ---- Site files -------------------------------------------------------------

export function sitemapXml(): string {
  const today = new Date().toISOString().slice(0, 10);
  const urls = ROUTES.map((route) => {
    const links = LOCALES.map(
      (l) =>
        `    <xhtml:link rel="alternate" hreflang="${LOCALE_META[l].htmlLang}" href="${pageUrl(route.page, l)}" />`,
    );
    links.push(
      `    <xhtml:link rel="alternate" hreflang="x-default" href="${pageUrl(route.page, DEFAULT_LOCALE)}" />`,
    );
    return [
      "  <url>",
      `    <loc>${pageUrl(route.page, route.locale)}</loc>`,
      `    <lastmod>${today}</lastmod>`,
      ...links,
      "  </url>",
    ].join("\n");
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");
}

// The app itself (everything behind sign-in, and the sign-in pages) answers
// with a noindex shell, which a crawler has to be allowed to fetch in order to
// see. Only the API is off limits: there is nothing there to index.
export function robotsTxt(): string {
  return ["User-agent: *", "Allow: /", "Disallow: /api/", "", `Sitemap: ${ORIGIN_TOKEN}/sitemap.xml`, ""].join(
    "\n",
  );
}

/** A plain-text brief for language models (llmstxt.org). English only. */
export function llmsTxt(c: Content): string {
  const guides = PAGES.filter((p): p is Exclude<PageId, "home"> => p !== "home").map(
    (p) =>
      `- [${c.guides[p].name}](${ORIGIN_TOKEN}${pagePath(p, DEFAULT_LOCALE)}): ${c.guides[p].meta.description}`,
  );
  return [
    `# ${SITE.name}`,
    "",
    `> ${c.llms.summary}`,
    "",
    "## Pages",
    "",
    `- [Home](${ORIGIN_TOKEN}/): ${c.home.meta.description}`,
    ...guides,
    `- [Sign up](${ORIGIN_TOKEN}/signup): Create a free workspace.`,
    "",
    "## What it does",
    "",
    ...c.llms.facts.map((fact) => `- ${fact}`),
    "",
    "## What it does not do",
    "",
    c.llms.notYet,
    "",
    "## Source and documentation",
    "",
    `- [Source code](${SITE.githubUrl}): ${SITE.license} licensed.`,
    `- [README](${repoFile("README.md")}): Features, quick start and project layout.`,
    `- [Deploy guide](${repoFile("DEPLOY.md")}): Production deployment, including Fly.io.`,
    `- [Database schema](${repoFile("SCHEMA.md")}): Tables and fields, for data mapping and import.`,
    `- [Concepts](${repoFile("CONCEPTS.md")}): The domain vocabulary.`,
    `- [Security policy](${repoFile("SECURITY.md")}): How to report a vulnerability.`,
    "",
  ].join("\n");
}
