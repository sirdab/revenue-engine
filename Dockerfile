# syntax=docker/dockerfile:1
#
# Single-app image: the api-server serves /api AND the built frontend on one
# port. Multi-stage so the runtime image ships only the esbuild bundle, the
# built frontend, and the minimal production node_modules (essentially just
# nodemailer — every other runtime import is bundled in by esbuild).
#
# MUST build for linux/amd64: pnpm-workspace.yaml strips every native binary
# (esbuild/rollup/lightningcss/tailwind-oxide) except linux-x64. Fly's remote
# builder is amd64, so `flyctl deploy --remote-only` is correct. Building
# locally on an Apple-silicon Mac requires `--platform linux/amd64` (buildx).

# ---- Base with pnpm -------------------------------------------------------
FROM --platform=linux/amd64 node:24-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
# The committed pnpm-lock.yaml is v9.0 format but was written by pnpm 10: its
# overrides-config hash only validates under pnpm >= 10, so pnpm 9
# fails `--frozen-lockfile` with ERR_PNPM_LOCKFILE_CONFIG_MISMATCH. No
# packageManager field exists, so pin pnpm 10 explicitly.
RUN corepack enable && corepack prepare pnpm@10.34.4 --activate
WORKDIR /app

# ---- Install full workspace deps (incl. dev deps needed to build) ---------
FROM base AS deps
# Copy manifests first for better layer caching. The root preinstall hook
# enforces the pnpm user-agent and runs fine here.
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc package.json ./
COPY lib ./lib
COPY artifacts ./artifacts
# Frozen install: exact locked versions, no resolution -> the workspace's
# minimumReleaseAge (1440) gate does not apply. devDependencies are installed
# (no --prod) because Vite/esbuild/tsc live there and the build needs them.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ---- Build both packages (api-server bundle + frontend) -------------------
FROM deps AS build
# vite.config.ts throws at eval time if BASE_PATH or PORT are missing, even
# though PORT only feeds the (unused-here) dev/preview server. Set both.
ARG BASE_PATH=/
ARG PORT=8080
ENV BASE_PATH=$BASE_PATH
ENV PORT=$PORT
# Sentry DSN for the frontend bundle. VITE_* vars are inlined at build time, so this must be a build arg, not just a Fly runtime secret. A
# Sentry DSN is not a secret (it's designed to be public in client code).
ARG VITE_SENTRY_DSN=""
ENV VITE_SENTRY_DSN=$VITE_SENTRY_DSN
# Copy the rest of the source, then build everything.
COPY . .
# `pnpm run build` = typecheck + `pnpm -r run build` (esbuild api-server, vite login).
RUN pnpm run build

# ---- Produce a minimal production node_modules for the api-server ---------
# Workspace libs (@workspace/*) and pg/pino are bundled by esbuild, so the only
# externalized runtime dep the bundle actually requires from node_modules is
# nodemailer. --legacy is required because pnpm 10 otherwise refuses to deploy a
# workspace that isn't set to inject-workspace-packages (ERR_PNPM_DEPLOY_
# NONINJECTED_WORKSPACE); we don't inject since the libs are bundled anyway.
FROM build AS prune
RUN pnpm deploy --filter @workspace/api-server --prod --legacy /prod

# ---- Runtime --------------------------------------------------------------
FROM --platform=linux/amd64 node:24-slim AS runner
ENV NODE_ENV=production
WORKDIR /app
# api-server bundle.
COPY --from=build /app/artifacts/api-server/dist ./dist
# Built frontend must sit at dist/public so import.meta.dirname + "public" hits it.
COPY --from=build /app/artifacts/web/dist/public ./dist/public
# The prerendered public pages (landing page, sitemap, robots), read at boot.
# Beside dist/public rather than inside it: they are served by the app, which
# fills in the site's origin, never as raw static files.
COPY --from=build /app/artifacts/web/dist/marketing ./dist/marketing
# Minimal prod deps (nodemailer). pnpm deploy writes them under /prod/node_modules.
COPY --from=prune /prod/node_modules ./node_modules
# The committed SQL migrations, for dist/migrate.mjs (self-hosted setups run it
# before the server: `node dist/migrate.mjs && node dist/index.mjs`).
COPY --from=build /app/lib/db/drizzle ./dist/migrations
EXPOSE 8080
# PORT is provided at runtime (fly.toml [env], docker-compose.yml); src/index.ts
# throws if absent.
CMD ["node", "--enable-source-maps", "./dist/index.mjs"]
