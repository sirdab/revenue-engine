// The public marketing site: which pages exist, where they live, and the few
// facts about the project every page repeats.
//
// These pages are not part of the single-page app. They are rendered to plain
// HTML at build time (see ../../marketing-plugin.ts) and served by the API
// server, so a crawler, a link preview or a slow phone gets the whole page in
// the first response with no framework to boot.
//
// Running a fork? This file, `content/`, and the brand mark in
// `components/brand.tsx` are where the names and links live (TRADEMARKS.md).

export const SITE = {
  /** Product name as people say it. */
  name: "Revenue Engine",
  /** Who builds it. Shown in the footer and in structured data. */
  company: "Sirdab",
  companyUrl: "https://sirdab.co",
  githubUrl: "https://github.com/sirdab/revenue-engine",
  designSystemUrl: "https://github.com/sirdab/one",
  license: "MIT",
  licenseUrl: "https://github.com/sirdab/revenue-engine/blob/main/LICENSE",
} as const;

/**
 * The hosted plan's price, for structured data. The pages say the same in
 * words (`pricing` in content/), so change both together. Self-hosting is free.
 */
export const HOSTED_PRICE = {
  currency: "SAR",
  /** Per seat, per month, billed annually. */
  perSeatMonth: "24.91",
  /** The one annual payment per seat. `perSeatMonth` is this over twelve, rounded down. */
  perSeatYear: "299",
  freeMonths: 3,
} as const;

export const repoFile = (path: string): string =>
  `${SITE.githubUrl}/blob/main/${path}`;

/**
 * Stands in for the public origin (`https://crm.example.com`) wherever a page
 * needs an absolute URL: canonical, hreflang, Open Graph, structured data, the
 * sitemap. The origin is only known where the site runs, so the server swaps
 * the token for `APP_BASE_URL` (or the request's own host) as it serves.
 */
export const ORIGIN_TOKEN = "__SITE_ORIGIN__";

export const LOCALES = ["en", "ar"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_META: Record<
  Locale,
  { dir: "ltr" | "rtl"; htmlLang: string; ogLocale: string; label: string }
> = {
  en: { dir: "ltr", htmlLang: "en", ogLocale: "en_US", label: "English" },
  ar: { dir: "rtl", htmlLang: "ar", ogLocale: "ar_SA", label: "العربية" },
};

export const PAGES = [
  "home",
  "open-source-crm",
  "pipedrive-alternative",
  "self-hosted-crm",
  "sales-management",
  "crm-software",
  "free-crm",
  "arabic-crm",
] as const;
export type PageId = (typeof PAGES)[number];

const SLUG: Record<PageId, string> = {
  home: "",
  "open-source-crm": "open-source-crm",
  "pipedrive-alternative": "pipedrive-alternative",
  "self-hosted-crm": "self-hosted-crm",
  "sales-management": "sales-management",
  "crm-software": "crm-software",
  "free-crm": "free-crm",
  "arabic-crm": "arabic-crm",
};

/** Site-relative path of a page: `/`, `/ar`, `/open-source-crm`, `/ar/open-source-crm`. */
export function pagePath(page: PageId, locale: Locale): string {
  const slug = SLUG[page];
  if (locale === DEFAULT_LOCALE) return `/${slug}`;
  return slug ? `/${locale}/${slug}` : `/${locale}`;
}

/** The same path as an absolute URL, with the origin still a token. */
export const pageUrl = (page: PageId, locale: Locale): string =>
  `${ORIGIN_TOKEN}${pagePath(page, locale)}`;

/**
 * Where the calls to action go. The app reads `?lang=` once, before it first
 * renders (initLocale), so someone who read the Arabic page signs up in Arabic.
 */
export function appPath(path: "/signup" | "/login", locale: Locale): string {
  return locale === DEFAULT_LOCALE ? path : `${path}?lang=${locale}`;
}

export interface Route {
  path: string;
  page: PageId;
  locale: Locale;
  /** Output file, relative to the marketing dist folder. */
  file: string;
  /**
   * Someone with a session cookie asking for this page is sent here instead.
   * Only the two home pages have it: a signed-in person who opens the site
   * wants their pipeline, while the other pages are worth reading either way.
   */
  redirectSignedInTo?: string;
}

export const ROUTES: Route[] = LOCALES.flatMap((locale) =>
  PAGES.map((page) => ({
    path: pagePath(page, locale),
    page,
    locale,
    file: `${locale}/${page}.html`,
    ...(page === "home" ? { redirectSignedInTo: "/home" } : {}),
  })),
);

export function matchRoute(pathname: string): Route | undefined {
  const clean = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return ROUTES.find((r) => r.path === clean);
}
