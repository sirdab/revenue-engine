// Turns a route into a finished HTML document. Loaded only at build time and
// by the dev server (marketing-plugin.ts); none of it reaches the browser.

import { renderToStaticMarkup } from "react-dom/server";
import { Shell } from "./components/layout";
import { ar } from "./content/ar";
import { en } from "./content/en";
import type { Content } from "./content/types";
import { GuidePage } from "./pages/guide";
import { HomePage } from "./pages/home";
import { headTags, llmsTxt, robotsTxt, sitemapXml } from "./seo";
import { DEFAULT_LOCALE, LOCALE_META, type Locale, type Route } from "./site";

export { ORIGIN_TOKEN, ROUTES, matchRoute } from "./site";

const CONTENT: Record<Locale, Content> = { en, ar };

// A <link data-mk-locale="ar"> in the shell is a preload only that language
// needs (its fonts). Keep the ones for this page and drop the attribute.
const LOCALE_LINK = /[ \t]*<link\b[^>]*\sdata-mk-locale="([a-z-]+)"[^>]*>\r?\n?/g;

export function renderDocument(template: string, route: Route): string {
  const c = CONTENT[route.locale];
  const props = { c, locale: route.locale, page: route.page };
  const body = renderToStaticMarkup(
    <Shell {...props}>{route.page === "home" ? <HomePage {...props} /> : <GuidePage {...props} />}</Shell>,
  );
  const { htmlLang, dir } = LOCALE_META[route.locale];
  // Replacer functions throughout: the copy is full of "$" (prices), which a
  // replacement string would read as a group reference.
  return template
    .replace(LOCALE_LINK, (tag, locale: string) =>
      locale === route.locale ? tag.replace(/\sdata-mk-locale="[a-z-]+"/, "") : "",
    )
    .replace("__MK_LANG__", () => htmlLang)
    .replace("__MK_DIR__", () => dir)
    .replace("<!--mk:head-->", () => headTags(c, route))
    .replace("<!--mk:body-->", () => body);
}

/** The files served beside the pages. Each still holds the origin token. */
export function siteFiles() {
  return [
    {
      path: "/sitemap.xml",
      file: "sitemap.xml",
      contentType: "application/xml; charset=utf-8",
      body: sitemapXml(),
    },
    {
      path: "/robots.txt",
      file: "robots.txt",
      contentType: "text/plain; charset=utf-8",
      body: robotsTxt(),
    },
    {
      path: "/llms.txt",
      file: "llms.txt",
      contentType: "text/plain; charset=utf-8",
      body: llmsTxt(CONTENT[DEFAULT_LOCALE]),
    },
  ];
}
