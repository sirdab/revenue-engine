import type { RequestHandler } from "express";

// One public address. Fly also serves every app on `<app>.fly.dev`, so the
// same pages answer there and search engines see two copies of the site.
// With APP_BASE_URL set, a page request that arrives on a *.fly.dev host is
// sent to the same path on APP_BASE_URL with a permanent redirect.
//
// Only GET/HEAD outside /api: API calls (and Fly's health check, which comes
// in on the machine's own address anyway) are answered where they land, so a
// client still pointed at fly.dev keeps working.

/** Where to send this request, or null to serve it here. */
export function canonicalRedirect(
  configured: string | undefined,
  req: { method: string; host: string | undefined; originalUrl: string },
): string | null {
  const base = configured?.trim().replace(/\/+$/, "");
  if (!base || !req.host) return null;
  if (req.method !== "GET" && req.method !== "HEAD") return null;
  if (req.originalUrl === "/api" || req.originalUrl.startsWith("/api/")) return null;
  const host = req.host.toLowerCase().replace(/:\d+$/, "");
  if (!host.endsWith(".fly.dev")) return null;
  let target: URL;
  try {
    target = new URL(base);
  } catch {
    return null;
  }
  if (target.hostname === host) return null;
  return `${base}${req.originalUrl}`;
}

export function canonicalHostMiddleware(): RequestHandler {
  return (req, res, next) => {
    const to = canonicalRedirect(process.env.APP_BASE_URL, {
      method: req.method,
      host: req.get("host"),
      originalUrl: req.originalUrl,
    });
    if (to) {
      res.redirect(301, to);
      return;
    }
    next();
  };
}
