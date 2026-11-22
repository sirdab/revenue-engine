import nodemailer, { type Transporter } from "nodemailer";
import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Central outbound mailer.
//
// A single SMTP transport used for every transactional email and
// notification. Works with any SMTP provider (AWS SES, Postmark, Mailgun, a
// local Mailpit, ...). Configuration comes entirely from the environment so no
// credentials live in code:
//
//   SMTP_HOST          e.g. email-smtp.eu-central-1.amazonaws.com
//   SMTP_PORT          587 (STARTTLS) by default, or 465 (implicit TLS)
//   SMTP_USER          optional; omit both user and password for no auth
//   SMTP_PASSWORD      optional (keep this a secret)
//   SMTP_REQUIRE_TLS   "false" to allow a plain session (local dev only)
//   MAIL_FROM          sender address, e.g. "Acme CRM <no-reply@acme.com>"
//
// The transport is built lazily and memoised. When the SMTP env is absent
// `sendMail` throws `MailerNotConfiguredError`; callers decide whether that is
// fatal (e.g. an explicit "resend" action) or merely logged (best-effort sends).
// ---------------------------------------------------------------------------

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface MailMessage {
  to: string | string[];
  cc?: string[];
  subject: string;
  text: string;
  html: string;
  attachments?: MailAttachment[];
}

export class MailerNotConfiguredError extends Error {
  constructor() {
    super("SMTP mailer is not configured (SMTP_HOST is not set)");
    this.name = "MailerNotConfiguredError";
  }
}

// `undefined` = not yet built, `null` = built and known-unconfigured.
let cached: Transporter | null | undefined;

function getTransport(): Transporter | null {
  if (cached !== undefined) return cached;
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  const port = Number(process.env.SMTP_PORT) || 587;
  const requireTls = process.env.SMTP_REQUIRE_TLS !== "false";
  if (!host) {
    cached = null;
    return null;
  }
  const secure = port === 465;
  cached = nodemailer.createTransport({
    host,
    port,
    // 465 = implicit TLS; 587/25 must negotiate STARTTLS (required explicitly
    // so we never fall back to an unencrypted session, unless opted out).
    secure,
    requireTLS: !secure && requireTls,
    ...(user && pass ? { auth: { user, pass } } : {}),
  });
  logger.info({ host, port }, "SMTP mailer configured");
  return cached;
}

export function isMailerConfigured(): boolean {
  return getTransport() !== null;
}

export function mailFrom(): string {
  return process.env.MAIL_FROM || "Revenue Engine <no-reply@localhost>";
}

/** Send an email via SMTP. Throws MailerNotConfiguredError when unconfigured. */
export async function sendMail(msg: MailMessage): Promise<void> {
  const transport = getTransport();
  if (!transport) throw new MailerNotConfiguredError();
  await transport.sendMail({ from: mailFrom(), ...msg });
  logger.info({ to: msg.to, cc: msg.cc, subject: msg.subject }, "Email sent");
}
