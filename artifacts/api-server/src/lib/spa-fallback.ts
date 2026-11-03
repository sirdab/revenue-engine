// Deciding which unmatched GETs get the SPA shell (index.html).
//
// The client is a single-page app: any path that isn't a real file must return
// index.html so the router can handle it. But that must NOT extend to requests
// for static assets. Vite emits content-hashed filenames under /assets/, and a
// deploy deletes the previous build's hashes. A browser still running the old
// index.html then asks for a chunk that no longer exists; if we answer with
// index.html, the browser gets a 200 of text/html where it expected a module
// and reports "'text/html' is not a valid JavaScript MIME type" (Safari) —
// which surfaces as an app crash rather than the recoverable chunk-load error
// the client already knows how to handle by reloading. A 404 is the honest
// answer for a file that genuinely isn't there.
//
// Kept as a pure function so the routing rules are unit-testable without
// standing up an Express app (and a database connection) to assert on them.

// Extensions that are always files, never client-side routes. Deliberately an
// allowlist rather than "any path containing a dot": route segments can hold
// dots (a company named "acme.co", a username "jane.doe"), and those are real
// navigations that must still resolve to the shell.
const ASSET_EXTENSIONS = new Set([
  "js", "mjs", "cjs", "css", "map", "json", "txt", "xml", "wasm",
  "png", "jpg", "jpeg", "gif", "svg", "webp", "avif", "ico", "bmp",
  "woff", "woff2", "ttf", "otf", "eot",
  "mp4", "webm", "mp3", "wav", "pdf", "zip", "csv",
]);

function hasAssetExtension(pathname: string): boolean {
  const lastSegment = pathname.slice(pathname.lastIndexOf("/") + 1);
  const dot = lastSegment.lastIndexOf(".");
  if (dot <= 0) return false;
  return ASSET_EXTENSIONS.has(lastSegment.slice(dot + 1).toLowerCase());
}

/**
 * True when an otherwise-unmatched request should receive index.html.
 *
 * False means "let it fall through" — the API router answers /api/* with a
 * JSON 404, and anything asset-shaped gets Express's plain 404 instead of a
 * misleading HTML body.
 */
export function shouldServeSpaShell(pathname: string, method: string): boolean {
  if (pathname.startsWith("/api/")) return false;
  if (method !== "GET" && method !== "HEAD") return false;
  // Everything under /assets/ is content-hashed and served by express.static
  // when it exists. Reaching the fallback means it doesn't — a stale deploy
  // reference, never a route.
  if (pathname.startsWith("/assets/")) return false;
  if (hasAssetExtension(pathname)) return false;
  return true;
}
