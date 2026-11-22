import path from "node:path";
import fs from "node:fs";
import express, { type Express } from "express";
import compression from "compression";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import * as Sentry from "@sentry/node";
import router from "./routes";
import { logger } from "./lib/logger";
import { shouldServeSpaShell } from "./lib/spa-fallback";
import { loadMarketingSite, marketingMiddleware } from "./lib/marketing-site";
import { SESSION_COOKIE } from "./lib/auth";

const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  throw new Error(
    "SESSION_SECRET environment variable is required to sign session cookies.",
  );
}

const app: Express = express();

// One hop behind the hosting proxy — required so req.ip reflects the real client
// for rate limiting. A numeric value (not `true`) keeps express-rate-limit happy.
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
// Compress responses (gzip/brotli). The hosting proxy does not compress for
// us, so without this the JS/CSS bundles ship uncompressed.
// Placed early so it covers both /api responses and the static frontend below.
//
// The Ask AI assistant route streams Server-Sent Events, and text/event-stream
// is gzip-compressible under compression's default filter — left as-is, that
// would buffer the stream behind compression's internal chunking and break
// incremental delivery. There's no per-route way to skip already-applied
// middleware in Express, so the exclusion lives in this single filter instead.
app.use(
  compression({
    filter: (req, res) => {
      if (req.path === "/api/assistant") return false;
      if (res.getHeader("Content-Type") === "text/event-stream") return false;
      return compression.filter(req, res);
    },
  }),
);
app.use(cors());
// The import wizard posts batches of up to 5000 rows, well past the default
// 100kb; only those routes get the larger limit. express.json skips a body
// that is already parsed, so the global parser below leaves these alone.
app.use("/api/import", express.json({ limit: "10mb" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser(SESSION_SECRET));

app.use("/api", router);

// --- The public marketing pages ---------------------------------------------
// The landing page at "/" and its siblings, sitemap.xml, robots.txt and
// llms.txt: prerendered by the web build into dist/marketing, next to the
// bundle (MARKETING_DIST overrides). Mounted before the static files and the
// app shell so these URLs are answered here; every other path falls through.
// With no marketing build present this is a no-op and "/" is the app's.
const marketingSite = loadMarketingSite(
  process.env.MARKETING_DIST ?? path.join(import.meta.dirname, "marketing"),
);
if (marketingSite) {
  app.use(marketingMiddleware(marketingSite, { sessionCookie: SESSION_COOKIE }));
  logger.info({ pages: marketingSite.pages.size }, "Serving the marketing pages");
}

// --- Serve the built frontend (single-process, same-origin) ----------------
// There is no separate frontend server or proxy routing /api to us, so the
// api-server serves both. The server is esbuild-bundled
// to dist/index.mjs and the build banner sets import.meta.dirname to that dist/
// directory; the Docker image copies the Vite build output to dist/public, so it
// sits right next to the bundle. CLIENT_DIST overrides for other layouts. The
// whole block is guarded on existence, so running the API alone in dev (no
// frontend build present) is a no-op and still just serves /api.
const clientDist =
  process.env.CLIENT_DIST ?? path.join(import.meta.dirname, "public");

if (fs.existsSync(clientDist)) {
  app.use(
    express.static(clientDist, {
      // index:false so "/" falls through to the SPA handler below — one code
      // path for index.html.
      index: false,
      // Vite emits content-hashed filenames under /assets — cache them hard.
      setHeaders: (res, filePath) => {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    }),
  );

  // SPA fallback. Express 5 forbids app.get("*", ...) (path-to-regexp v8 rejects
  // a bare "*"), so use a terminal middleware that inspects req.path instead of
  // a route pattern. shouldServeSpaShell holds the rules (and their tests): it
  // must NOT hijack the API — unknown /api/* requests fall through to a JSON 404
  // from the router — only serves HTML for GET/HEAD navigations, and never
  // answers a request for a static asset, so a chunk deleted by a deploy 404s
  // instead of returning index.html as text/html.
  app.use((req, res, next) => {
    if (!shouldServeSpaShell(req.path, req.method)) return next();
    // With `root`, only "index.html" is checked against the dotfile rule. An
    // absolute path is checked whole, so a checkout under ~/.something would
    // 404 its own app shell.
    res.sendFile("index.html", { root: clientDist });
  });
}

// Report unhandled route errors to Sentry (no-op when SENTRY_DSN is unset).
// Must be registered after all routes/middleware. Express 5 forwards async
// rejections thrown from route handlers here automatically.
Sentry.setupExpressErrorHandler(app);

// Minimal JSON fallback so the API returns a clean 500 instead of Express's
// default HTML stack-trace page. Four args => Express treats it as an error
// handler. Response header check guards against double-send if a stream/SSE
// route already started writing.
app.use(
  (
    err: unknown,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    if (res.headersSent) return next(err);
    // body-parser's own rejections (malformed JSON, a body over the limit)
    // are the client's error and say so with `expose`; answer them with their
    // real 4xx instead of a 500 that reads as a server fault.
    const { status, expose, message } = (err ?? {}) as {
      status?: unknown;
      expose?: unknown;
      message?: unknown;
    };
    if (
      expose === true &&
      typeof status === "number" &&
      status >= 400 &&
      status < 500
    ) {
      res.status(status).json({ error: String(message) });
      return;
    }
    logger.error({ err }, "Unhandled request error");
    res.status(500).json({ error: "Internal Server Error" });
  },
);

export default app;
