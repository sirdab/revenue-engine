import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import { and, eq, inArray } from "drizzle-orm";
import { db, linkPreviewsTable } from "@workspace/db";
import { PgRateLimitStore } from "./rate-limit-store-pg";
import { logger } from "./logger";
import {
  extractPreviewUrls,
  isGlobalUnicastAddress,
  validateUrlShape,
  type UrlShape,
} from "./link-preview-validation";

// Re-export the pure validation core (CI-tested in link-preview-validation.ts).
export {
  extractPreviewUrls,
  isGlobalUnicastAddress,
  validateUrlShape,
  MAX_URL_LENGTH,
  MAX_URLS_PER_COMMENT,
} from "./link-preview-validation";

// ---------------------------------------------------------------------------
// Link previews (R11): unfurl http(s) URLs in posted comments into OG cards,
// SAFELY. This is the repo's first arbitrary-URL fetcher, so the fetch layer is
// ours and takes an ALLOW-ONLY-GLOBAL-UNICAST posture: a socket address is
// contacted only if it is a normal public address (IPv4 and IPv6, IPv4-mapped
// and NAT64 forms normalized to their embedded IPv4 first). Enumerating deny
// ranges misses whole families (0.0.0.0/8, ::ffff:127.0.0.1, Fly's fdaa::/16,
// NAT64) — allow-listing fails closed instead.
//
// The impure fetch resolves DNS itself and connects to the validated IP via a
// custom `lookup` (closing the DNS-rebinding TOCTOU — the address validated is
// the address connected to), restricts scheme to http(s) and port to 80/443 on
// the initial URL and every redirect hop, caps time and bytes, sends no
// cookie/auth headers, and denies the app's own public origin. Parsing is
// delegated to open-graph-scraper over the *already-fetched* HTML (never its
// own fetch), so the SSRF layer is never bypassed.
//
// The pure pieces (URL extraction + IP/URL classification) are exported for the
// CI unit tests in link-preview.test.ts.
// ---------------------------------------------------------------------------

const MAX_REDIRECTS = 3;
const TOTAL_TIMEOUT_MS = 5000;
const MAX_BYTES = 1024 * 1024; // 1 MB, decompressed (we request identity)
const OK_TTL_MS = 7 * 24 * 3600 * 1000;
const FAIL_TTL_MS = 24 * 3600 * 1000;

// -------------------------- impure: hardened fetch -------------------------

// Custom lookup: resolve, then connect ONLY to a global-unicast address. The
// address returned here is the one the socket connects to, so validation and
// connection are the same act — no DNS-rebinding window.
function safeLookup(
  hostname: string,
  options: dns.LookupOneOptions | dns.LookupAllOptions,
  callback: (
    err: NodeJS.ErrnoException | null,
    address: string | dns.LookupAddress[],
    family?: number,
  ) => void,
): void {
  dns.lookup(hostname, { all: true }, (err, addresses) => {
    if (err) return callback(err, "", 0);
    // Keep every global-unicast (public) candidate. The socket only ever
    // connects to an address returned here, so validating all of them closes
    // the DNS-rebinding window whichever one Happy Eyeballs races to.
    const safe = addresses.filter((a) => isGlobalUnicastAddress(a.address));
    if (safe.length === 0) {
      callback(
        new Error(`blocked non-public address for ${hostname}`),
        "",
        0,
      );
      return;
    }
    // Node's connect path enables autoSelectFamily (Happy Eyeballs) by default
    // since Node 20, calling lookup with { all: true } and REQUIRING the
    // array-form callback. Answering with the single-address form makes Node
    // read the address string as the address list ("Invalid IP address:
    // undefined"), so every fetch fails. Honor whichever form was requested.
    if (options.all) {
      callback(null, safe);
    } else {
      callback(null, safe[0].address, safe[0].family);
    }
  });
}

interface RawResponse {
  status: number;
  location?: string;
  contentType?: string;
  body: string;
}

function requestOnce(
  shape: UrlShape,
  deadline: number,
): Promise<RawResponse | null> {
  return new Promise((resolve) => {
    const lib = shape.protocol === "https:" ? https : http;
    const remaining = deadline - Date.now();
    if (remaining <= 0) return resolve(null);

    let settled = false;
    // Absolute wall-clock deadline: http.request's `timeout` is a per-socket
    // INACTIVITY timer (resets on every byte), so a slow-drip server could hold
    // the connection open far past the budget. This hard timer destroys the
    // request regardless of byte pacing.
    const hardTimer = setTimeout(() => {
      req.destroy();
      done(null);
    }, remaining);
    const done = (v: RawResponse | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimer);
      resolve(v);
    };

    const req = lib.request(
      shape.href,
      {
        method: "GET",
        // No cookie/auth headers; ask for uncompressed so the byte cap is also
        // the decompressed cap (no decompression bomb).
        headers: {
          "User-Agent": "RevenueEngine-LinkPreview/1.0",
          Accept: "text/html,application/xhtml+xml",
          "Accept-Encoding": "identity",
        },
        lookup: safeLookup,
        // Per-socket inactivity timer (complements the wall-clock hardTimer).
        timeout: remaining,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const location = res.headers.location;
        // Redirect — return without reading a body; the caller re-validates.
        if (status >= 300 && status < 400 && location) {
          res.destroy();
          done({ status, location, body: "" });
          return;
        }
        const contentType = String(res.headers["content-type"] ?? "");
        if (!/text\/html|application\/xhtml/i.test(contentType)) {
          res.destroy();
          done({ status, contentType, body: "" });
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BYTES) {
            res.destroy();
            done({ status, contentType, body: Buffer.concat(chunks).toString("utf8") });
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () =>
          done({ status, contentType, body: Buffer.concat(chunks).toString("utf8") }),
        );
        res.on("error", () => done(null));
      },
    );
    req.on("timeout", () => {
      req.destroy();
      done(null);
    });
    req.on("error", () => done(null));
    req.end();
  });
}

/**
 * Fetch a URL's HTML through the SSRF layer, following up to MAX_REDIRECTS hops
 * and re-validating scheme/port/origin (and, via safeLookup, the resolved IP)
 * at EVERY hop. Returns the final HTML + URL, or null if anything is rejected.
 */
export async function fetchHtmlSafely(
  startUrl: string,
  appOrigin?: string | null,
): Promise<{ url: string; html: string } | null> {
  const deadline = Date.now() + TOTAL_TIMEOUT_MS;
  let current = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const shape = validateUrlShape(current, appOrigin);
    if (!shape) return null;
    const res = await requestOnce(shape, deadline);
    if (!res) return null;
    if (res.status >= 300 && res.status < 400 && res.location) {
      try {
        current = new URL(res.location, current).toString();
      } catch {
        return null;
      }
      continue;
    }
    if (res.status < 200 || res.status >= 300) return null;
    if (!res.body) return null;
    return { url: shape.href, html: res.body };
  }
  return null; // too many redirects
}

// -------------------------- cache + rate limit -----------------------------

export interface PreviewCard {
  url: string;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  siteName: string | null;
}

// Per-user and per-host hourly caps on live unfurls (cache hits are free). The
// PgRateLimitStore is shared-instance-safe; we drive it directly (no Express
// middleware here — unfurl runs fire-and-forget after commit).
const UNFURL_WINDOW_MS = 3600_000;
const USER_LIMIT = 60;
const HOST_LIMIT = 120;
const userStore = new PgRateLimitStore("unfurl-user:");
const hostStore = new PgRateLimitStore("unfurl-host:");
userStore.init({ windowMs: UNFURL_WINDOW_MS } as never);
hostStore.init({ windowMs: UNFURL_WINDOW_MS } as never);

async function underLimit(
  store: PgRateLimitStore,
  key: string,
  limit: number,
): Promise<boolean> {
  const { totalHits } = await store.increment(key);
  return totalHits <= limit;
}

async function upsertPreview(
  url: string,
  status: "ok" | "failed",
  card?: Omit<PreviewCard, "url">,
): Promise<void> {
  // ON CONFLICT DO UPDATE — two instances unfurling the same URL must not
  // error; last-writer-wins is correct for a cache.
  await db
    .insert(linkPreviewsTable)
    .values({
      url,
      status,
      title: card?.title ?? null,
      description: card?.description ?? null,
      imageUrl: card?.imageUrl ?? null,
      siteName: card?.siteName ?? null,
    })
    .onConflictDoUpdate({
      target: linkPreviewsTable.url,
      set: {
        status,
        title: card?.title ?? null,
        description: card?.description ?? null,
        imageUrl: card?.imageUrl ?? null,
        siteName: card?.siteName ?? null,
        fetchedAt: new Date(),
      },
    });
}

async function isCachedFresh(url: string): Promise<boolean> {
  const [row] = await db
    .select({ status: linkPreviewsTable.status, fetchedAt: linkPreviewsTable.fetchedAt })
    .from(linkPreviewsTable)
    .where(eq(linkPreviewsTable.url, url));
  if (!row) return false;
  const ttl = row.status === "ok" ? OK_TTL_MS : FAIL_TTL_MS;
  return Date.now() - new Date(row.fetchedAt).getTime() < ttl;
}

/**
 * Unfurl the URLs found in a posted comment. Fire-and-forget after commit (like
 * notifyMentions) — never throws. Cache hits and rate-limited URLs are skipped;
 * failures are negative-cached so they aren't retried on every render.
 */
export async function unfurlCommentUrls(
  html: string,
  userId: number,
): Promise<void> {
  try {
    const urls = extractPreviewUrls(html);
    if (urls.length === 0) return;
    const appOrigin = process.env.APP_BASE_URL ?? null;
    const ogs = (await import("open-graph-scraper")).default;

    for (const url of urls) {
      if (await isCachedFresh(url)) continue;
      let host: string;
      try {
        host = new URL(url).hostname;
      } catch {
        continue;
      }
      const [okUser, okHost] = await Promise.all([
        underLimit(userStore, String(userId), USER_LIMIT),
        underLimit(hostStore, host, HOST_LIMIT),
      ]);
      if (!okUser || !okHost) continue;

      const fetched = await fetchHtmlSafely(url, appOrigin);
      if (!fetched) {
        await upsertPreview(url, "failed");
        continue;
      }
      try {
        // Parse ONLY the HTML we already fetched through the SSRF layer — never
        // pass `url` too, or open-graph-scraper both rejects the call ("Must
        // specify either `url` or `html`, not both") AND would otherwise do its
        // own unguarded fetch, defeating the whole hardened-fetch design.
        const { result } = await ogs({
          html: fetched.html,
          onlyGetOpenGraphInfo: true,
        });
        const title = result.ogTitle ?? result.twitterTitle ?? null;
        const description =
          result.ogDescription ?? result.twitterDescription ?? null;
        const siteName = result.ogSiteName ?? null;
        // Image URL is kept as metadata only; the card renders text-only by
        // default (no external image loads — see the frontend card).
        const imageUrl = result.ogImage?.[0]?.url ?? null;
        if (!title && !description && !siteName) {
          await upsertPreview(url, "failed");
        } else {
          await upsertPreview(url, "ok", { title, description, imageUrl, siteName });
        }
      } catch {
        await upsertPreview(url, "failed");
      }
    }
  } catch (err) {
    logger.error({ err }, "link-preview unfurl failed");
  }
}

/**
 * Batched: for a set of notes, return each note's OK preview cards keyed by
 * note id. One query over all URLs in the list (never per-note).
 */
export async function loadPreviewsForNotes(
  notes: { id: number; content: string }[],
): Promise<Map<number, PreviewCard[]>> {
  const byNote = new Map<number, PreviewCard[]>();
  const urlsByNote = new Map<number, string[]>();
  const allUrls = new Set<string>();
  for (const n of notes) {
    const urls = extractPreviewUrls(n.content);
    if (urls.length) {
      urlsByNote.set(n.id, urls);
      urls.forEach((u) => allUrls.add(u));
    }
  }
  if (allUrls.size === 0) return byNote;

  const rows = await db
    .select({
      url: linkPreviewsTable.url,
      title: linkPreviewsTable.title,
      description: linkPreviewsTable.description,
      imageUrl: linkPreviewsTable.imageUrl,
      siteName: linkPreviewsTable.siteName,
    })
    .from(linkPreviewsTable)
    .where(
      and(
        inArray(linkPreviewsTable.url, [...allUrls]),
        eq(linkPreviewsTable.status, "ok"),
      ),
    );
  const cardByUrl = new Map<string, PreviewCard>();
  for (const r of rows) cardByUrl.set(r.url, r);

  for (const [noteId, urls] of urlsByNote) {
    const cards = urls
      .map((u) => cardByUrl.get(u))
      .filter((c): c is PreviewCard => Boolean(c));
    if (cards.length) byNote.set(noteId, cards);
  }
  return byNote;
}
