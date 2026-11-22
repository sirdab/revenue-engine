import fs from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { marketingSite } from "./marketing-plugin";

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    "BASE_PATH environment variable is required but was not provided.",
  );
}

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    // The public landing pages: served at `/` in dev, prerendered on build.
    marketingSite(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    rollupOptions: {
      // Two entries: the app shell, and the shell of the public marketing
      // pages (no React at runtime; see marketing-plugin.ts).
      input: {
        main: path.resolve(import.meta.dirname, "index.html"),
        marketing: path.resolve(import.meta.dirname, "marketing.html"),
      },
      output: {
        // Split the always-loaded, rarely-changing vendors out of the entry
        // chunk so frequent app deploys don't invalidate them in browser
        // caches (the served /assets files are immutable-cached for a year).
        // Only eagerly-imported libraries belong here — chunking lazy-only
        // ones (recharts, dnd-kit, radix) would drag them into first load.
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return undefined;
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) {
            return "vendor-react";
          }
          if (
            id.includes("@tanstack/react-query") ||
            id.includes("node_modules/wouter/") ||
            id.includes("node_modules/regexparam/")
          ) {
            return "vendor-router-query";
          }
          return undefined;
        },
      },
    },
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    // Local dev only: set VITE_DEV_TLS_KEY / VITE_DEV_TLS_CERT (PEM paths) to
    // serve the dev server over https. Needed to review from another device on
    // the LAN, because the api-server's session cookie is `Secure` by design
    // and browsers drop it over plain http on any host other than localhost.
    https:
      process.env.VITE_DEV_TLS_KEY && process.env.VITE_DEV_TLS_CERT
        ? {
            key: fs.readFileSync(process.env.VITE_DEV_TLS_KEY),
            cert: fs.readFileSync(process.env.VITE_DEV_TLS_CERT),
          }
        : undefined,
    fs: {
      strict: true,
    },
    // Local dev only: set VITE_API_PROXY=http://localhost:5000 to forward /api
    // to a locally-running api-server. No effect in production (built output).
    proxy: process.env.VITE_API_PROXY
      ? {
          "/api": {
            target: process.env.VITE_API_PROXY,
            changeOrigin: true,
            secure: false,
          },
        }
      : undefined,
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
