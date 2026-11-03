import net from "node:net";

// Pure, dependency-free SSRF-validation + URL-extraction core for the link
// preview unfurler (R11). No @workspace/db import, so it is unit-testable under
// `node --test` without a database (the file-validation.ts precedent). The
// impure fetch/cache layer in link-preview.ts imports from here.

export const MAX_URL_LENGTH = 2000;
export const MAX_URLS_PER_COMMENT = 3;

// -------------------------- URL extraction ---------------------------------

const HREF_RE = /<a\b[^>]*\bhref="([^"]+)"/gi;

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'");
}

/**
 * Extract http(s) anchor hrefs from stored comment HTML: deduped, over-long
 * URLs skipped (unfurl policy + btree index safety), capped at the first N.
 */
export function extractPreviewUrls(html: string | null | undefined): string[] {
  if (!html) return [];
  const urls: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  HREF_RE.lastIndex = 0;
  while ((m = HREF_RE.exec(html)) && urls.length < MAX_URLS_PER_COMMENT) {
    const raw = decodeEntities(m[1]).trim();
    if (!/^https?:\/\//i.test(raw)) continue;
    if (raw.length > MAX_URL_LENGTH) continue;
    if (seen.has(raw)) continue;
    seen.add(raw);
    urls.push(raw);
  }
  return urls;
}

// -------------------------- IP classification ------------------------------

function ipv4ToBytes(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const bytes: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    bytes.push(n);
  }
  return bytes;
}

function ipv6ToBytes(ipRaw: string): number[] | null {
  let ip = ipRaw.split("%")[0]; // strip zone id
  // Embedded IPv4 dotted tail (::ffff:1.2.3.4) → convert to two hextets.
  const lastColon = ip.lastIndexOf(":");
  const tail = ip.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = ipv4ToBytes(tail);
    if (!v4) return null;
    const hex = `${((v4[0] << 8) | v4[1]).toString(16)}:${(
      (v4[2] << 8) |
      v4[3]
    ).toString(16)}`;
    ip = ip.slice(0, lastColon + 1) + hex;
  }
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const back =
    halves.length === 2 ? (halves[1] ? halves[1].split(":") : []) : null;
  let hextets: string[];
  if (back === null) {
    hextets = head;
  } else {
    const missing = 8 - head.length - back.length;
    if (missing < 0) return null;
    hextets = [...head, ...Array(missing).fill("0"), ...back];
  }
  if (hextets.length !== 8) return null;
  const bytes: number[] = [];
  for (const h of hextets) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(h || "0")) return null;
    const n = parseInt(h || "0", 16);
    bytes.push((n >> 8) & 0xff, n & 0xff);
  }
  return bytes;
}

function isGlobalUnicastV4(b: number[]): boolean {
  const [a, b1, c] = b;
  if (a === 0) return false; // 0.0.0.0/8
  if (a === 10) return false; // private
  if (a === 100 && b1 >= 64 && b1 <= 127) return false; // CGNAT 100.64/10
  if (a === 127) return false; // loopback
  if (a === 169 && b1 === 254) return false; // link-local
  if (a === 172 && b1 >= 16 && b1 <= 31) return false; // 172.16/12
  if (a === 192 && b1 === 0 && c === 0) return false; // 192.0.0/24
  if (a === 192 && b1 === 0 && c === 2) return false; // TEST-NET-1
  if (a === 192 && b1 === 88 && c === 99) return false; // 6to4 relay anycast
  if (a === 192 && b1 === 168) return false; // private
  if (a === 198 && (b1 === 18 || b1 === 19)) return false; // benchmarking
  if (a === 198 && b1 === 51 && c === 100) return false; // TEST-NET-2
  if (a === 203 && b1 === 0 && c === 113) return false; // TEST-NET-3
  if (a >= 224) return false; // multicast (224/4) + reserved (240/4) + broadcast
  return true;
}

function isGlobalUnicastV6(b: number[]): boolean {
  if (b.every((x) => x === 0)) return false; // :: unspecified
  if (b.slice(0, 15).every((x) => x === 0) && b[15] === 1) return false; // ::1
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return false; // fe80::/10 link-local
  if ((b[0] & 0xfe) === 0xfc) return false; // fc00::/7 ULA (incl fdaa::/16)
  if (b[0] === 0xff) return false; // ff00::/8 multicast
  return true;
}

/**
 * Allow-only-global-unicast predicate for a resolved socket address. Rejects
 * every private / loopback / link-local / ULA / multicast / reserved form,
 * normalizing IPv4-mapped (::ffff:) and NAT64 (64:ff9b::/96) IPv6 to their
 * embedded IPv4 first. Anything it can't parse is denied.
 */
export function isGlobalUnicastAddress(ip: string): boolean {
  const fam = net.isIP(ip);
  if (fam === 4) {
    const b = ipv4ToBytes(ip);
    return b ? isGlobalUnicastV4(b) : false;
  }
  if (fam === 6) {
    const b = ipv6ToBytes(ip);
    if (!b) return false;
    // IPv4-mapped ::ffff:0:0/96
    if (b.slice(0, 10).every((x) => x === 0) && b[10] === 0xff && b[11] === 0xff) {
      return isGlobalUnicastV4(b.slice(12, 16));
    }
    // NAT64 well-known prefix 64:ff9b::/96
    if (
      b[0] === 0x00 &&
      b[1] === 0x64 &&
      b[2] === 0xff &&
      b[3] === 0x9b &&
      b.slice(4, 12).every((x) => x === 0)
    ) {
      return isGlobalUnicastV4(b.slice(12, 16));
    }
    // IPv4-compatible ::/96 (deprecated) — classify the embedded v4. Also
    // subsumes :: (→ 0.0.0.0) and ::1 (→ 0.0.0.1), both rejected by the v4 rule.
    if (b.slice(0, 12).every((x) => x === 0)) {
      return isGlobalUnicastV4(b.slice(12, 16));
    }
    // 6to4 2002::/16 — the embedded v4 (bytes 2-5) is the real destination.
    if (b[0] === 0x20 && b[1] === 0x02) {
      return isGlobalUnicastV4(b.slice(2, 6));
    }
    // Teredo 2001:0000::/32 — tunneled; deny outright (not 2001:4860:… etc.).
    if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x00 && b[3] === 0x00) {
      return false;
    }
    return isGlobalUnicastV6(b);
  }
  return false;
}

// -------------------------- URL shape --------------------------------------

export interface UrlShape {
  href: string;
  hostname: string;
  protocol: "http:" | "https:";
  port: number;
}

/**
 * Validate scheme (http/https), port (80/443), and that the URL is not the
 * app's own public origin. Does NOT touch DNS — the resolved-IP check happens
 * at connect time. Returns null (reject) on any failure.
 */
export function validateUrlShape(
  urlStr: string,
  appOrigin?: string | null,
): UrlShape | null {
  let u: URL;
  try {
    u = new URL(urlStr);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const port = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
  if (port !== 80 && port !== 443) return null;
  // CRITICAL: reject non-global-unicast IP-LITERAL hosts here. Node's connect
  // skips the custom DNS `lookup` hook entirely for IP literals, so safeLookup
  // never classifies them — without this, http://127.0.0.1/, http://[::1]/,
  // http://169.254.169.254/, http://[fd00::1]/ (port 80/443) would reach
  // internal services. validateUrlShape runs on the initial URL AND every
  // redirect hop, so this covers redirects too. (u.hostname keeps brackets on
  // IPv6 literals; strip them for net.isIP / the classifier.)
  const bareHost = u.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(bareHost) && !isGlobalUnicastAddress(bareHost)) return null;
  // Strip URL-embedded credentials so no Authorization header is derived.
  u.username = "";
  u.password = "";
  if (appOrigin) {
    try {
      if (u.origin === new URL(appOrigin).origin) return null;
    } catch {
      // ignore an unparsable appOrigin
    }
  }
  return {
    href: u.toString(),
    hostname: u.hostname,
    protocol: u.protocol as "http:" | "https:",
    port,
  };
}
