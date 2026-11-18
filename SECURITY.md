# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Report them
privately through GitHub: the repository's **Security** tab → **Report a
vulnerability**. Include what you found, how to reproduce it and what an
attacker could do with it.

You should get an acknowledgement within a few days. Once a fix is released
we'll credit you in the release notes unless you'd rather stay anonymous.

## Scope

Things we especially want to hear about:

- **Cross-workspace access**: any way for a user of one workspace to read or
  change another workspace's data. Isolation relies on Postgres row-level
  security (see `CLAUDE.md` → Multi-tenancy), so a query path that escapes the
  tenant scope is a vulnerability even if nothing leaks today.
- Authentication and session bypasses, privilege escalation to admin.
- Injection (SQL, stored XSS through notes, comments or imported data), SSRF
  through link previews or webhooks.

## Running it safely

- Connect the app as a database role that is **neither superuser nor
  BYPASSRLS**. Either one silently turns tenant isolation off.
- Use a long random `SESSION_SECRET` (`openssl rand -hex 32`) and serve the app
  over HTTPS.
- Never run `pnpm seed` against a database you care about: it deletes every
  workspace.
