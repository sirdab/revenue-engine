# Deploying

The app ships as **one container running one Node process**. The API server
serves both `/api` and the built web app on one port, so no proxy is needed.
Several machines can serve at once, because all state lives in Postgres. You
need:

- a **Postgres 13+** database, reached as an ordinary role (see below);
- somewhere to run the container: Fly.io (below), or any container host;
- optionally SMTP for email, S3-compatible storage for attachments, and an
  Anthropic API key for Ask AI.

## The one database rule

Workspaces are kept apart by Postgres **row-level security**. Superusers and
roles with `BYPASSRLS` skip it entirely, so isolation would silently be off.
The admin user a managed Postgres gives you is often such a role. Never put
it in the app's `DATABASE_URL`. Create a dedicated role that owns the app's
database:

```sql
-- as the provider's admin user
CREATE ROLE crm_app LOGIN PASSWORD '<long random password>' NOSUPERUSER NOBYPASSRLS;
GRANT crm_app TO CURRENT_USER;   -- lets a non-superuser admin create a DB owned by it
CREATE DATABASE crm OWNER crm_app;
```

The app connects as `postgres://crm_app:<password>@<host>:5432/crm`. Migrations
create the `pg_trgm` extension, which is trusted on Postgres 13+, so the owner
can do it without a superuser.

**Connect directly, not through a transaction-mode pooler.** The app binds a
connection to a workspace with a session setting (`app.tenant_id`), and the
migration runner takes a session-level advisory lock. PgBouncer in transaction
mode hands each statement to whichever server connection is free, so the
setting made on one connection would be read on another: at best empty
results, at worst another workspace's rows. Use the database's direct
endpoint. A pooler in *session* mode is fine. The app keeps its own pool
(`DB_POOL_MAX`, 10 connections per machine by default).

## Migrations

The image contains the committed migrations (`lib/db/drizzle/`) and a runner:
`node dist/migrate.mjs`. Run it before starting new code. It is safe to run on
every deploy: applied migrations are skipped, and an advisory lock stops two
machines from migrating at once. On Fly it is the `release_command` in
`fly.toml`, so every deploy migrates first and a failed migration stops the
deploy. From a checkout you can also run `pnpm db:migrate` with `DATABASE_URL`
set.

Never point `drizzle-kit push` at a real database. It is a local shortcut that
skips the row-level-security migration.

## Fly.io, step by step

You need [`flyctl`](https://fly.io/docs/flyctl/install/) (a recent version;
older ones can't create Managed Postgres) and `fly auth login`. Pick an app
name (`my-crm` below), an organization (`fly orgs list`) and a region
(`fra` below), and set `app` in `fly.toml` to your app name.

### 1. Create the database

```bash
fly mpg create --name my-crm-db --org <org> --region fra --plan Basic
fly mpg list --org <org>                  # note the cluster id
```

Managed Postgres does not hand out a role that can run `CREATE ROLE`, so
create the database and the app's user through `flyctl` instead of the SQL
above. Its `schema_admin` users are ordinary roles (neither superuser nor
`BYPASSRLS`), which is what the app needs:

```bash
fly mpg databases create <cluster-id> --name crm
fly mpg users create <cluster-id> --username crm_app --role schema_admin
fly mpg users rotate-password <cluster-id> --username crm_app   # prints the password
```

`fly mpg status <cluster-id>` shows the cluster's **direct** address
(`direct.<cluster-id>.flympg.net`). The app's connection string is

```
postgres://crm_app:<password>@direct.<cluster-id>.flympg.net:5432/crm
```

Two things to avoid:

- The connection string `fly mpg create` prints, and the one `fly mpg attach`
  sets, point at `pgbouncer.<cluster-id>.flympg.net`. Don't use them: see
  [the database rule](#the-one-database-rule) on poolers.
- Don't use the default `fly-user` / `fly-db` pair for the app. Give it its
  own user and database, as above.

To check the result, `fly mpg connect <cluster-id> --database crm --username
crm_app -c "select rolsuper, rolbypassrls from pg_roles where rolname =
session_user"` should print `f | f`.

Using another provider (Neon, Supabase, RDS…)? Create the role and database
the same way and use its connection string, adding `?sslmode=require` if the
provider wants TLS.

### 2. Create the app and its secrets

```bash
fly apps create my-crm --org <org>

fly secrets set --stage --app my-crm \
  DATABASE_URL="postgres://crm_app:<password>@<private-host>:5432/crm" \
  SESSION_SECRET="$(openssl rand -hex 32)" \
  APP_BASE_URL="https://my-crm.fly.dev"

# Optional, any time later (all listed in .env.example)
fly secrets set --stage --app my-crm \
  APP_NAME="Acme CRM" APP_TIMEZONE="Europe/London" PHONE_COUNTRY_CODE="44" \
  MAIL_FROM="Acme CRM <no-reply@example.com>" \
  SMTP_HOST="…" SMTP_PORT="587" SMTP_USER="…" SMTP_PASSWORD="…" \
  S3_ENDPOINT="…" S3_BUCKET_NAME="…" S3_ACCESS_KEY_ID="…" S3_SECRET_ACCESS_KEY="…" \
  ANTHROPIC_API_KEY="…"
```

### 3. Deploy

```bash
fly deploy --remote-only --app my-crm
```

`--remote-only` builds on Fly's amd64 builders. The image is linux/amd64 only,
so don't build it locally on Apple silicon. The release command migrates
the empty database, then the app starts. Open `https://my-crm.fly.dev`: the
landing page is at `/`, and **Start for free** leads to the sign-up page,
where you create your workspace.

Attachments need object storage. On Fly, `fly storage create --app my-crm`
makes a Tigris bucket and prints its credentials; set them under the names
the app reads:

```bash
fly secrets set --app my-crm \
  S3_ENDPOINT="https://fly.storage.tigris.dev" S3_REGION="auto" \
  S3_BUCKET_NAME="<bucket>" S3_ACCESS_KEY_ID="…" S3_SECRET_ACCESS_KEY="…"
```

Only want an admin account, without leaving sign-up as the way in? Create the
first workspace from your machine through a proxy:

```bash
fly mpg proxy --cluster <cluster-id>      # in another terminal; listens on localhost
BOOTSTRAP_ADMIN_EMAIL=you@example.com BOOTSTRAP_ADMIN_PASSWORD='…' \
BOOTSTRAP_WORKSPACE_NAME="Acme" \
DATABASE_URL="postgres://crm_app:<password>@localhost:<proxy-port>/crm" \
  pnpm bootstrap
```

### 4. Optional: deploy on every push to `main`

`.github/workflows/deploy.yml` runs `fly deploy` once CI has passed on `main`.
It does nothing until you turn it on. Protect `main` first (require a pull
request and the `build` check), because the environment below only opens to
protected branches. Then:

```bash
gh api -X PUT repos/OWNER/REPO/environments/production --input - \
  <<< '{"deployment_branch_policy":{"protected_branches":true,"custom_branch_policies":false}}'
fly tokens create deploy --app my-crm \
  | gh secret set FLY_API_TOKEN --env production
gh variable set FLY_APP --body my-crm
```

Keep the token in the environment, not in the repository's secrets: a repository
secret can be read by a workflow pushed to any branch.

### Sizing

`fly.toml` runs one `shared-cpu-1x` machine with 2 GB and auto-starts and stops
machines with traffic. `min_machines_running = 1` keeps one warm. Scale with
`fly scale count` / `fly scale vm`; every machine shares the same database.

## The public pages

The image also serves a landing page at `/` (and `/ar`), three longer pages
(`/open-source-crm`, `/self-hosted-crm`, `/pipedrive-alternative`),
`/sitemap.xml`, `/robots.txt` and `/llms.txt`. They are plain HTML, rendered
when the image is built, and the app itself stays behind `/login` and
`/signup` with a `noindex` shell.

- **Set `APP_BASE_URL`** to the address people use. It is written into every
  canonical link, the Open Graph tags, the structured data and the sitemap.
  Unset, each request's own host is used, which is fine for a try-out and
  wrong the day you add a second domain.
- **A custom domain**: `fly certs add crm.example.com --app my-crm`, add the
  DNS records it prints, then set `APP_BASE_URL=https://crm.example.com`. The
  `.fly.dev` address keeps working and names the new one as canonical.
- **After the first deploy**, submit `https://<your-domain>/sitemap.xml` in
  Google Search Console and Bing Webmaster Tools.
- **Running a fork?** The pages carry Sirdab's name and marks. Replace them
  first: see [`TRADEMARKS.md`](TRADEMARKS.md).

## Other hosts

Build the image (`docker build -t crm .` on an amd64 machine or in CI) and run
it with the environment variables from `.env.example`. Use port 8080 unless
you set `PORT`, and run the migrations before the server:

```bash
docker run -p 8080:8080 --env-file .env crm \
  sh -c "node dist/migrate.mjs && exec node --enable-source-maps dist/index.mjs"
```

Serve it over HTTPS, since the session cookie is `Secure` in production, and
set `APP_BASE_URL` to the public URL so links in emails and Slack messages are
right.

`docker-compose.yml`'s `app` profile (`docker compose --profile app up -d
--build`) is a local try-out, not a deployment: it always sends email to
Mailpit (whose inbox has no login, and password-reset links land there) and
stores files in the bundled RustFS with default credentials. Its services
listen on `127.0.0.1` only. For a server, run the image as above with a real
SMTP provider and object store.

## Production checklist

- [ ] `DATABASE_URL` uses a role that is **not** superuser and **not** BYPASSRLS
- [ ] `SESSION_SECRET` is long and random, and differs per environment
- [ ] HTTPS in front of the app; `APP_BASE_URL` set to the public URL
- [ ] `DATABASE_URL` reaches Postgres directly, not through a transaction-mode pooler
- [ ] `WEBHOOK_ALLOW_PRIVATE_ADDRESSES` is unset if anyone can sign up (outbound
      webhooks then cannot be pointed at your private network)
- [ ] Backups enabled on the database (Fly Managed Postgres has them by default)
- [ ] Never run `pnpm seed` against it: it deletes every workspace
