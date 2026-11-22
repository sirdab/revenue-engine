// Serving the public marketing pages.
//
// The web build prerenders them (artifacts/web/marketing-plugin.ts) into a
// folder of plain HTML plus sitemap.xml, robots.txt, llms.txt and a manifest
// that says which URL gets which file. This module loads that folder once and
// answers those URLs. It knows nothing about what the pages say.
//
// Two things happen on the way out:
//
//   - Absolute URLs. A page cannot know its own origin at build time, so
//     canonical links, Open Graph tags, structured data and the sitemap carry
//     a token where the origin belongs. It is replaced here with APP_BASE_URL,
//     or with the host the request came in on when that is unset.
//   - The front door. Someone holding a session cookie who asks for a page
//     marked `redirectSignedInTo` (the home page) is sent into the app. Only
//     the cookie's presence is checked: a stale one costs a detour through
//     /home to /login, never a loop, because /login is not such a page.
//
// Kept free of database imports and split into a pure resolver plus a thin
// middleware, so the routing rules are unit-tested without a server.

import fs from "node:fs";
import path from "node:path";
import type { Request, RequestHandler } from "express";

interface Manifest {
  version: number;
  originToken: string;
  pages: { path: string; file: string; redirectSignedInTo?: string }[];
  files: { path: string; file: string; contentType: string }[];
}

interface Page {
  html: string;
  redirectSignedInTo?: string;
}

interface SiteFile {
  body: string;
  contentType: string;
}

export interface MarketingSite {
  originToken: string;
  pages: Map<string, Page>;
  files: Map<string, SiteFile>;
}

/**
 * Reads the prerendered site into memory. Returns null when `dir` holds no
 * manifest: the API running on its own in development, or an image built
 * without the web app. A manifest that names a missing file is a broken build
 * and throws, so a bad deploy fails at boot instead of serving half a site.
 */
export function loadMarketingSite(dir: string): MarketingSite | null {
  const manifestPath = path.join(dir, "manifest.json");
  if (!fs.existsSync(manifestPath)) return null;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Manifest;
  if (manifest.version !== 1) {
    throw new Error(`Unsupported marketing manifest version: ${manifest.version}`);
  }
  const read = (file: string) => fs.readFileSync(path.join(dir, file), "utf8");
  return {
    originToken: manifest.originToken,
    pages: new Map(
      manifest.pages.map((p) => [
        p.path,
        { html: read(p.file), redirectSignedInTo: p.redirectSignedInTo },
      ]),
    ),
    files: new Map(
      manifest.files.map((f) => [f.path, { body: read(f.file), contentType: f.contentType }]),
    ),
  };
}

export type MarketingResponse =
  | { kind: "redirect"; status: 301 | 302; location: string }
  | {
      kind: "body";
      body: string;
      contentType: string;
      cacheControl: string;
      /** The response differs for signed-in visitors. */
      variesByCookie: boolean;
    };

export interface MarketingRequest {
  method: string;
  /** Path only, no query string. */
  path: string;
  /** Whether a session cookie came with the request. */
  hasSession: boolean;
  /** Public origin to write into absolute URLs, e.g. `https://crm.example.com`. */
  origin: string;
}

// The pages change only with a deploy, but a signed-in visitor gets a redirect
// from the same URL, so browsers must check back every time. `no-cache` allows
// a 304 on the ETag, which is all a repeat visit costs.
const PAGE_CACHE = "no-cache";
const FILE_CACHE = "public, max-age=3600";

/** What to answer for this request, or null when it is not a marketing URL. */
export function resolveMarketingRequest(
  site: MarketingSite,
  req: MarketingRequest,
): MarketingResponse | null {
  if (req.method !== "GET" && req.method !== "HEAD") return null;

  const withOrigin = (s: string) => s.split(site.originToken).join(req.origin);

  const file = site.files.get(req.path);
  if (file) {
    return {
      kind: "body",
      body: withOrigin(file.body),
      contentType: file.contentType,
      cacheControl: FILE_CACHE,
      variesByCookie: false,
    };
  }

  // One URL per page: `/ar/` is the same page as `/ar` and says so with a
  // permanent redirect, rather than being a second copy for crawlers to find.
  if (req.path.length > 1 && req.path.endsWith("/")) {
    const bare = req.path.replace(/\/+$/, "");
    return site.pages.has(bare) ? { kind: "redirect", status: 301, location: bare } : null;
  }

  const page = site.pages.get(req.path);
  if (!page) return null;
  if (page.redirectSignedInTo && req.hasSession) {
    return { kind: "redirect", status: 302, location: page.redirectSignedInTo };
  }
  return {
    kind: "body",
    body: withOrigin(page.html),
    contentType: "text/html; charset=utf-8",
    cacheControl: PAGE_CACHE,
    variesByCookie: Boolean(page.redirectSignedInTo),
  };
}

// A Host header is whatever the client sent, and it ends up inside HTML
// attributes. Anything that is not a plain host[:port] is ignored.
const HOST = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::\d{1,5})?$/i;

/**
 * The origin to use in absolute URLs: APP_BASE_URL when set (always set it in
 * production, so every page names one canonical host), else the request's own.
 */
export function publicOrigin(
  configured: string | undefined,
  req: { protocol: string; host: string | undefined },
): string {
  const base = configured?.trim().replace(/\/+$/, "");
  if (base) return base;
  return req.host && HOST.test(req.host) ? `${req.protocol}://${req.host}` : "";
}

export function marketingMiddleware(
  site: MarketingSite,
  options: { sessionCookie: string },
): RequestHandler {
  return (req: Request, res, next) => {
    const result = resolveMarketingRequest(site, {
      method: req.method,
      path: req.path,
      hasSession: Boolean(req.signedCookies?.[options.sessionCookie]),
      origin: publicOrigin(process.env.APP_BASE_URL, {
        protocol: req.protocol,
        host: req.get("host"),
      }),
    });
    if (!result) return next();

    if (result.kind === "redirect") {
      // Keep the query string across the trailing-slash redirect.
      const query = req.originalUrl.includes("?")
        ? req.originalUrl.slice(req.originalUrl.indexOf("?"))
        : "";
      res.redirect(result.status, result.status === 301 ? result.location + query : result.location);
      return;
    }
    res.setHeader("Content-Type", result.contentType);
    res.setHeader("Cache-Control", result.cacheControl);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    if (result.variesByCookie) res.vary("Cookie");
    res.send(result.body);
  };
}
