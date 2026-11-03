# Security policy

## Reporting a vulnerability

Please do not report security issues through public GitHub issues.

Use GitHub's private vulnerability reporting on this repository (Security tab →
"Report a vulnerability"). Include what you found, how to reproduce it, and the
impact you expect. We aim to acknowledge reports within a few working days and
will keep you updated until a fix is released.

## Supported versions

Security fixes land on the `main` branch. Run the latest release.

## Hardening checklist for self-hosters

- Set a long random `SESSION_SECRET` and keep it secret; rotating it signs
  everyone out.
- Serve the app over HTTPS only (production cookies are `Secure`).
- Give the database user only the access the app needs, and keep backups.
- Keep the inbound webhook secret (Admin → Settings → Integrations) private and
  rotate it if it leaks.
- Restrict the S3 bucket for attachments to the app's credentials; files are
  served through the API, never by public URL.
