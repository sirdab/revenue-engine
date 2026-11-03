import nodemailer, { type Transporter } from "nodemailer";
import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Central outbound mailer.
//
// A single SMTP transport (AWS SES) used for every transactional email and,
// later, notifications. Configuration comes entirely from the environment so no
// credentials live in code:
//
//   AWS_SES_SMTP_ENDPOINT   e.g. email-smtp.eu-central-1.amazonaws.com
//   AWS_SES_SMTP_USER       SES SMTP username (an IAM access key id)
//   AWS_SES_SMTP_PASSWORD   SES SMTP password (keep this a secret)
//   AWS_SMTP_PORT           587 (STARTTLS) by default, or 465 (implicit TLS)
//   MAIL_FROM               verified SES sender, e.g. "Acme CRM <no-reply@example.com>"
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
    super("SMTP mailer is not configured (missing AWS_SES_SMTP_* env)");
    this.name = "MailerNotConfiguredError";
  }
}

// `undefined` = not yet built, `null` = built and known-unconfigured.
let cached: Transporter | null | undefined;

function getTransport(): Transporter | null {
  if (cached !== undefined) return cached;
  const host = process.env.AWS_SES_SMTP_ENDPOINT;
  const user = process.env.AWS_SES_SMTP_USER;
  const pass = process.env.AWS_SES_SMTP_PASSWORD;
  const port = Number(process.env.AWS_SMTP_PORT) || 587;
  if (!host || !user || !pass) {
    cached = null;
    return null;
  }
  const secure = port === 465;
  cached = nodemailer.createTransport({
    host,
    port,
    // 465 = implicit TLS; 587/25 must negotiate STARTTLS (require it explicitly
    // so we never fall back to an unencrypted session against SES).
    secure,
    requireTLS: !secure,
    auth: { user, pass },
  });
  logger.info({ host, port }, "SMTP mailer configured");
  return cached;
}

export function isMailerConfigured(): boolean {
  return getTransport() !== null;
}

export function mailFrom(): string {
  return process.env.MAIL_FROM || "CRM <no-reply@example.com>";
}

/** Send an email via SMTP. Throws MailerNotConfiguredError when unconfigured. */
export async function sendMail(msg: MailMessage): Promise<void> {
  const transport = getTransport();
  if (!transport) throw new MailerNotConfiguredError();
  await transport.sendMail({ from: mailFrom(), ...msg });
  logger.info({ to: msg.to, cc: msg.cc, subject: msg.subject }, "Email sent");
}
