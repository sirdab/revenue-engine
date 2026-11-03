import { logger } from "./logger";
import { sendMail, MailerNotConfiguredError } from "./mailer";

/**
 * Public base URL of the front-end app, used to build links inside emails.
 * In production set APP_BASE_URL to the deployed domain (e.g.
 * https://crm.example.com). In development we fall back to localhost.
 */
export function appBaseUrl(): string {
  const explicit = process.env.APP_BASE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  return "http://localhost";
}

// ---------------------------------------------------------------------------
// Shared branded HTML shell so every email looks consistent.
// ---------------------------------------------------------------------------

/**
 * Escape user-controlled text before it goes into the HTML body/attributes,
 * so a name/title/URL containing `&`, `<`, `>`, or quotes renders as text
 * instead of breaking the layout or injecting markup.
 */
export function htmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** The product name shown in emails. APP_NAME overrides the default. */
export const APP_NAME = process.env.APP_NAME?.trim() || "CRM";

/** Chrome options for the shared email shell. */
export interface ShellOptions {
  maxWidthPx?: number;
  title?: string;
  footer?: string;
}

export function shell(
  innerHtml: string,
  {
    maxWidthPx = 520,
    title = APP_NAME,
    footer = `Sent by ${APP_NAME}`,
  }: ShellOptions = {},
): string {
  return `<!doctype html>
<html>
  <body style="margin:0;background:#eef2f4;font-family:'DM Sans',Inter,Arial,sans-serif;color:#1A212D;">
    <div style="max-width:${maxWidthPx}px;margin:0 auto;padding:40px 24px;">
      <div style="background:linear-gradient(135deg,#039BA0,#0c7d80);border-radius:20px 20px 0 0;padding:28px 32px;">
        <div style="font-size:13px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:rgba(255,255,255,0.75);">${htmlEscape(APP_NAME)}</div>
        <div style="font-size:22px;font-weight:700;color:#ffffff;margin-top:4px;">${htmlEscape(title)}</div>
      </div>
      <div style="background:#ffffff;border-radius:0 0 20px 20px;padding:32px;border:1px solid #e5e7eb;border-top:none;">
        ${innerHtml}
      </div>
      <p style="text-align:center;font-size:12px;color:#9ca3af;margin:24px 0 0;">
        ${htmlEscape(footer)}
      </p>
    </div>
  </body>
</html>`;
}

function button(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;background:#039BA0;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 24px;border-radius:10px;">${label}</a>`;
}

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

export interface PasswordResetEmail {
  to: string;
  name: string;
  resetUrl: string;
}

function buildResetEmail(
  name: string,
  resetUrl: string,
): { subject: string; text: string; html: string } {
  const subject = `Reset your ${APP_NAME} password`;
  const text = [
    `Hi ${name},`,
    "",
    `We received a request to reset the password for your ${APP_NAME} account.`,
    "Use the link below within the next hour to choose a new password:",
    "",
    resetUrl,
    "",
    "Didn't request this? You can safely ignore this email and your password stays the same.",
    "",
    `The ${APP_NAME} team`,
  ].join("\n");

  const html = shell(`
    <h1 style="font-size:20px;margin:0 0 16px;color:#1A212D;">Reset your password</h1>
    <p style="font-size:15px;line-height:1.6;color:#3f4756;margin:0 0 24px;">
      Hi ${htmlEscape(name)}, we received a request to reset the password for your ${APP_NAME} account.
      Click the button below within the next hour to choose a new password.
    </p>
    ${button(resetUrl, "Reset password")}
    <p style="font-size:13px;line-height:1.6;color:#6b7280;margin:24px 0 0;">
      If the button doesn't work, copy and paste this link into your browser:<br />
      <a href="${resetUrl}" style="color:#039BA0;word-break:break-all;">${resetUrl}</a>
    </p>
    <p style="font-size:13px;line-height:1.6;color:#6b7280;margin:24px 0 0;">
      Didn't request this? You can safely ignore this email and your password stays the same.
    </p>`);

  return { subject, text, html };
}

/**
 * Sends the password-reset email. This send is best-effort: a missing mailer or
 * a transient failure never blocks the flow and is never leaked to the client.
 * In development the reset link is logged so the flow stays testable.
 */
export async function sendPasswordResetEmail({
  to,
  name,
  resetUrl,
}: PasswordResetEmail): Promise<void> {
  const { subject, text, html } = buildResetEmail(name, resetUrl);
  try {
    await sendMail({ to, subject, text, html });
  } catch (err) {
    const unconfigured = err instanceof MailerNotConfiguredError;
    if (process.env.NODE_ENV === "production") {
      logger.error(
        { err: (err as Error).message, to },
        "Failed to send password reset email",
      );
    } else {
      logger.warn(
        { err: (err as Error).message, to, unconfigured },
        "Could not send password reset email",
      );
      logger.info(
        { to, resetUrl },
        "DEV fallback — password reset link (email not sent)",
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Generic notification email (assignment, reminders — the notification
// controller renders content, this renders chrome and handles the send with
// the same dev-fallback behavior as the other senders).
// ---------------------------------------------------------------------------

export interface NotificationEmail {
  to: string;
  subject: string;
  heading: string;
  bodyLines: string[];
  ctaLabel?: string;
  ctaUrl?: string;
}

export async function sendNotificationEmail(
  p: NotificationEmail,
): Promise<boolean> {
  const text = [p.heading, "", ...p.bodyLines, "", p.ctaUrl ?? ""].join("\n");
  const html = shell(`
    <h1 style="font-size:20px;margin:0 0 10px;color:#1A212D;">${htmlEscape(p.heading)}</h1>
    ${p.bodyLines
      .map(
        (l) =>
          `<p style="font-size:15px;line-height:1.6;color:#3f4756;margin:0 0 10px;">${htmlEscape(l)}</p>`,
      )
      .join("")}
    ${
      p.ctaUrl
        ? `<a href="${htmlEscape(p.ctaUrl)}" style="display:inline-block;margin-top:10px;background:#039BA0;color:#ffffff;font-size:14px;font-weight:600;padding:10px 18px;border-radius:8px;text-decoration:none;">${htmlEscape(p.ctaLabel ?? "Open")}</a>`
        : ""
    }
  `);
  try {
    await sendMail({ to: p.to, subject: p.subject, text, html });
    return true;
  } catch (err) {
    const unconfigured = err instanceof MailerNotConfiguredError;
    if (process.env.NODE_ENV === "production") {
      logger.error(
        { err: (err as Error).message, to: p.to, subject: p.subject },
        "Failed to send notification email",
      );
    } else {
      logger.info(
        { to: p.to, subject: p.subject, body: p.bodyLines, url: p.ctaUrl, unconfigured },
        "DEV fallback — notification email (not sent)",
      );
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Account credentials (new account / resend)
// ---------------------------------------------------------------------------

export interface AccountCredentialsEmail {
  to: string;
  name: string;
  email: string;
  password: string;
  loginUrl: string;
  /** true for a freshly created account, false when re-sending details. */
  isNew: boolean;
}

function buildAccountEmail(p: AccountCredentialsEmail): {
  subject: string;
  text: string;
  html: string;
} {
  const subject = p.isNew
    ? `Welcome to ${APP_NAME}`
    : `Your ${APP_NAME} login details`;
  const intro = p.isNew
    ? `Your account on ${APP_NAME} is ready. Here is everything you need to jump in.`
    : `Here are your fresh ${APP_NAME} login details. We reset your password to a new temporary one.`;

  const text = [
    `Hi ${p.name},`,
    "",
    intro,
    "",
    `Email:    ${p.email}`,
    `Password: ${p.password}`,
    "",
    `Sign in: ${p.loginUrl}`,
    "",
    "Tip: change your password once you're in to keep your account secure.",
    "",
    "See you inside,",
    `The ${APP_NAME} team`,
  ].join("\n");

  const html = shell(`
    <h1 style="font-size:22px;margin:0 0 8px;color:#1A212D;">
      ${p.isNew ? `Welcome aboard, ${htmlEscape(p.name)} 👋` : "Your login details"}
    </h1>
    <p style="font-size:15px;line-height:1.6;color:#3f4756;margin:0 0 20px;">
      ${intro}
    </p>
    <table style="width:100%;border-collapse:separate;border-spacing:0;background:#f8fafc;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;margin:0 0 24px;">
      <tr>
        <td style="padding:14px 16px;font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:#6b7280;border-bottom:1px solid #eef2f7;">Email</td>
        <td style="padding:14px 16px;font-size:14px;font-weight:600;color:#1A212D;border-bottom:1px solid #eef2f7;">${htmlEscape(p.email)}</td>
      </tr>
      <tr>
        <td style="padding:14px 16px;font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:#6b7280;">Temporary password</td>
        <td style="padding:14px 16px;font-size:15px;font-weight:700;color:#039BA0;font-family:'SFMono-Regular',Consolas,monospace;letter-spacing:1px;">${htmlEscape(p.password)}</td>
      </tr>
    </table>
    ${button(p.loginUrl, "Sign in to Revenue Engine")}
    <p style="font-size:13px;line-height:1.6;color:#6b7280;margin:24px 0 0;">
      Tip: change your password once you're in to keep your account secure.
    </p>`);

  return { subject, text, html };
}

/**
 * Sends a user their account credentials. Unlike the reset email this throws on
 * failure so callers (e.g. an explicit "resend" action) can react — and so the
 * account password is never rotated when the email could not be delivered.
 */
export async function sendAccountCredentialsEmail(
  p: AccountCredentialsEmail,
): Promise<void> {
  const { subject, text, html } = buildAccountEmail(p);
  await sendMail({ to: p.to, subject, text, html });
  logger.info({ to: p.to, isNew: p.isNew }, "Account credentials email sent");
}
