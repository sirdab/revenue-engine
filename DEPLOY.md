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

Open a `psql` session as the admin user and run the SQL from
[the database rule](#the-one-database-rule) above:

```bash
fly mpg connect --cluster <cluster-id>
```

`fly mpg status <cluster-id>` shows the private host name. The app's
connection string is
`postgres://crm_app:<password>@<private-host>:5432/crm`. Don't use
`fly mpg attach`: it hands the app the admin user.

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
the empty database, then the app starts. Open `https://my-crm.fly.dev` and
create your workspace from the sign-up page.

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

`.github/workflows/deploy.yml` typechecks and runs `fly deploy`. It does
nothing until you turn it on:

```bash
fly tokens create deploy --app my-crm     # copy the token
gh secret set FLY_API_TOKEN --body "FlyV1 …"
gh variable set FLY_APP --body my-crm
```

### Sizing

`fly.toml` runs one `shared-cpu-1x` machine with 2 GB and auto-starts and stops
machines with traffic. `min_machines_running = 1` keeps one warm. Scale with
`fly scale count` / `fly scale vm`; every machine shares the same database.

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
- [ ] Backups enabled on the database (Fly Managed Postgres has them by default)
- [ ] Never run `pnpm seed` against it: it deletes every workspace
