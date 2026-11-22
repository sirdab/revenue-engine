// Renders the public marketing pages (src/marketing) to static HTML.
//
// `marketing.html` is a second Vite entry, so its stylesheet, script and fonts
// are bundled and hashed like the app's. The page content is React, rendered
// to a string and dropped into that shell:
//
//   - `vite dev`  : on each request, so `/` shows the landing page and an edit
//                   reloads it. Everything else still reaches the app.
//   - `vite build`: once per page and locale, into `dist/marketing/` next to
//                   (not inside) `dist/public`, plus sitemap.xml, robots.txt,
//                   llms.txt and a manifest the API server reads. Outside the
//                   static root on purpose: the files still hold the origin
//                   token and must only go out through the server.
//
// The React tree never ships to the browser. `src/marketing/client.ts` is the
// only script on these pages.
import fs from "node:fs";
import path from "node:path";
import {
  createServer,
  type Plugin,
  type ResolvedConfig,
  type ViteDevServer,
} from "vite";
import react from "@vitejs/plugin-react";

const RENDER_MODULE = "/src/marketing/render.tsx";
const TEMPLATE_FILE = "marketing.html";

interface Route {
  path: string;
  file: string;
  redirectSignedInTo?: string;
}

interface SiteFile {
  /** URL path it is served at, e.g. `/sitemap.xml`. */
  path: string;
  /** File name inside the marketing dist folder. */
  file: string;
  contentType: string;
  body: string;
}

interface RenderModule {
  ORIGIN_TOKEN: string;
  ROUTES: Route[];
  matchRoute(pathname: string): Route | undefined;
  renderDocument(template: string, route: Route): string;
  siteFiles(): SiteFile[];
}

/** Written to `dist/marketing/manifest.json`; read by the API server. */
export interface MarketingManifest {
  version: 1;
  originToken: string;
  pages: { path: string; file: string; redirectSignedInTo?: string }[];
  files: { path: string; file: string; contentType: string }[];
}

// The session cookie's name (api-server/src/lib/auth.ts). Its presence is all
// the dev server checks; the API decides whether it is still valid.
const SESSION_COOKIE = /(?:^|;\s*)sid=/;

export function marketingSite(): Plugin {
  let config: ResolvedConfig;

  const templatePath = () => path.resolve(config.root, TEMPLATE_FILE);

  return {
    name: "marketing-site",

    configResolved(resolved) {
      config = resolved;
    },

    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        if (req.method !== "GET" && req.method !== "HEAD") return next();
        const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
        // Modules, assets and API calls are never marketing URLs: let them
        // through without touching the render module. What is left is paths
        // that look like pages, plus the .xml and .txt site files.
        if (
          pathname.startsWith("/@") ||
          pathname.startsWith("/api/") ||
          (/\.[a-z0-9]+$/i.test(pathname) && !/\.(xml|txt)$/.test(pathname))
        ) {
          return next();
        }
        try {
          const site = (await server.ssrLoadModule(RENDER_MODULE)) as RenderModule;
          const scheme = server.config.server.https ? "https" : "http";
          const origin = `${scheme}://${req.headers.host ?? "localhost"}`;
          const withOrigin = (s: string) => s.split(site.ORIGIN_TOKEN).join(origin);

          const file = site.siteFiles().find((f) => f.path === pathname);
          if (file) {
            res.setHeader("Content-Type", file.contentType);
            res.end(withOrigin(file.body));
            return;
          }

          const route = site.matchRoute(pathname);
          if (!route) return next();
          if (route.redirectSignedInTo && SESSION_COOKIE.test(req.headers.cookie ?? "")) {
            res.statusCode = 302;
            res.setHeader("Location", route.redirectSignedInTo);
            res.end();
            return;
          }
          const template = await server.transformIndexHtml(
            `/${TEMPLATE_FILE}`,
            fs.readFileSync(templatePath(), "utf8"),
          );
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.setHeader("Cache-Control", "no-store");
          res.end(withOrigin(site.renderDocument(template, route)));
        } catch (err) {
          server.ssrFixStacktrace(err as Error);
          next(err);
        }
      });
    },

    // The pages are rendered on the server, so the browser holds no module to
    // hot-swap: reload it when their source changes. Styles and client.ts are
    // ordinary client modules and update on their own.
    handleHotUpdate({ file, server }) {
      const dir = path.resolve(config.root, "src/marketing") + path.sep;
      if (!file.startsWith(dir)) return;
      if (file.endsWith(".css") || file.endsWith("client.ts")) return;
      server.ws.send({ type: "full-reload" });
    },

    async closeBundle(buildError?: Error) {
      // Nothing to render from when the build itself failed; let that error stand.
      if (config.command !== "build" || buildError) return;

      const outDir = path.resolve(config.root, config.build.outDir);
      const builtTemplate = path.join(outDir, TEMPLATE_FILE);
      if (!fs.existsSync(builtTemplate)) {
        // A build without the landing page would still deploy, and serve the
        // sign-in form at "/". Fail here instead.
        throw new Error(
          `marketing: ${TEMPLATE_FILE} was not emitted. Is it still listed in build.rollupOptions.input?`,
        );
      }
      const template = fs.readFileSync(builtTemplate, "utf8");
      const siteDir = path.resolve(outDir, "..", "marketing");

      // A throwaway server, only to load the render module through Vite's own
      // TypeScript/JSX pipeline; it never listens.
      const loader = await createServer({
        root: config.root,
        configFile: false,
        logLevel: "error",
        appType: "custom",
        server: { middlewareMode: true, hmr: false, watch: null },
        optimizeDeps: { noDiscovery: true },
        plugins: [react()],
      });
      try {
        const site = (await loader.ssrLoadModule(RENDER_MODULE)) as RenderModule;
        fs.rmSync(siteDir, { recursive: true, force: true });

        for (const route of site.ROUTES) {
          const target = path.join(siteDir, route.file);
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, site.renderDocument(template, route));
        }
        const files = site.siteFiles();
        for (const file of files) {
          fs.writeFileSync(path.join(siteDir, file.file), file.body);
        }
        const manifest: MarketingManifest = {
          version: 1,
          originToken: site.ORIGIN_TOKEN,
          pages: site.ROUTES.map(({ path: p, file, redirectSignedInTo }) => ({
            path: p,
            file,
            ...(redirectSignedInTo ? { redirectSignedInTo } : {}),
          })),
          files: files.map(({ path: p, file, contentType }) => ({
            path: p,
            file,
            contentType,
          })),
        };
        fs.writeFileSync(
          path.join(siteDir, "manifest.json"),
          JSON.stringify(manifest, null, 2),
        );
        // The unfilled shell has no business being reachable at /marketing.html.
        fs.rmSync(builtTemplate);
        config.logger.info(
          `marketing: ${site.ROUTES.length} pages, ${files.length} files → ${path.relative(config.root, siteDir)}`,
        );
      } finally {
        await loader.close();
      }
    },
  };
}
