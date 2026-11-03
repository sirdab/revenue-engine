import { logger } from "./logger";
import { TEMPLATE_FIELDS } from "@workspace/automation-placeholders";
import { getSetting, setSetting, clearSetting } from "./app-settings";

// isAllowedTemplateToken lives in the shared placeholder module now; re-export
// it here so existing importers (admin-automations) keep their import path.
export { isAllowedTemplateToken } from "@workspace/automation-placeholders";

// Slack sender for the automations "Send Slack message" action.
//
// Each workspace (tenant) connects its OWN Slack, stored in its app_settings
// (Settings → Integrations), so one tenant's automations can never post into
// another tenant's Slack. Two transports, picked by what's configured:
//   • bot token (xoxb-…) — a full Slack app. Posts to any channel and DMs
//     users (chat.postMessage). Required for per-channel routing and DMs.
//   • incoming webhook URL — one fixed channel. Used only for a channel
//     destination when no bot token is set.
//
// Every send is best-effort: missing config or a Slack outage logs and moves
// on, never blocking or failing the deal write that triggered it.
//
// SLACK_STUB=1 (local only) captures sends into an in-memory outbox instead of
// hitting Slack, so the flow is testable without a real workspace.

const TIMEOUT_MS = 5000;
const STUB = process.env.SLACK_STUB === "1";

const BOT_TOKEN_KEY = "slack_bot_token";
const WEBHOOK_URL_KEY = "slack_webhook_url";
const ANNOUNCE_CHANNEL_KEY = "slack_announce_channel";

interface SlackCredentials {
  botToken: string | null;
  webhookUrl: string | null;
}

/** The current tenant's Slack connection. */
async function slackCredentials(): Promise<SlackCredentials> {
  const [botToken, webhookUrl] = await Promise.all([
    getSetting(BOT_TOKEN_KEY),
    getSetting(WEBHOOK_URL_KEY),
  ]);
  return { botToken, webhookUrl };
}

export async function isSlackConfigured(): Promise<boolean> {
  const { botToken, webhookUrl } = await slackCredentials();
  return !!(botToken || webhookUrl);
}

/** What the settings page may show: whether each credential is set, never
 *  the secret itself. */
export interface SlackSettingsView {
  botTokenSet: boolean;
  webhookUrlSet: boolean;
  announceChannel: string | null;
}

export async function getSlackSettings(): Promise<SlackSettingsView> {
  const [{ botToken, webhookUrl }, announceChannel] = await Promise.all([
    slackCredentials(),
    getSetting(ANNOUNCE_CHANNEL_KEY),
  ]);
  return {
    botTokenSet: !!botToken,
    webhookUrlSet: !!webhookUrl,
    announceChannel,
  };
}

export class SlackSettingsError extends Error {}

/** Update the tenant's Slack connection. `undefined` leaves a value as it is,
 *  `null` or "" clears it. */
export async function updateSlackSettings(input: {
  botToken?: string | null;
  webhookUrl?: string | null;
  announceChannel?: string | null;
}): Promise<SlackSettingsView> {
  const apply = async (key: string, value: string | null | undefined) => {
    if (value === undefined) return;
    const v = value?.trim() ?? "";
    if (v) await setSetting(key, v);
    else await clearSetting(key);
  };
  if (input.botToken && !input.botToken.trim().startsWith("xoxb-")) {
    throw new SlackSettingsError("A Slack bot token starts with xoxb-.");
  }
  if (
    input.webhookUrl &&
    !input.webhookUrl.trim().startsWith("https://hooks.slack.com/")
  ) {
    throw new SlackSettingsError(
      "A Slack incoming webhook URL starts with https://hooks.slack.com/.",
    );
  }
  await apply(BOT_TOKEN_KEY, input.botToken);
  await apply(WEBHOOK_URL_KEY, input.webhookUrl);
  await apply(ANNOUNCE_CHANNEL_KEY, input.announceChannel);
  return getSlackSettings();
}

// ---- Local test outbox (SLACK_STUB=1) ------------------------------------
interface OutboxEntry {
  at: string;
  to: string;
  text: string;
}
const outbox: OutboxEntry[] = [];
export function slackOutbox(): OutboxEntry[] {
  return outbox;
}
function stubCapture(to: string, text: string): void {
  outbox.push({ at: new Date().toISOString(), to, text });
  if (outbox.length > 200) outbox.shift();
  logger.info({ to, text }, "[SLACK STUB] would send");
}

// ---- Resolved intent (what the runner collects, fired after commit) ------
export type SlackTarget =
  | { kind: "channel"; channel: string } // channel name/id, or "" = webhook's channel
  | { kind: "email"; email: string }; // DM the user with this email

export interface SlackIntent {
  target: SlackTarget;
  text: string;
  /** Optional Block Kit blocks; `text` stays the notification fallback. */
  blocks?: unknown[];
}

async function slackApi(
  method: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const token = (await slackCredentials()).botToken;
  if (!token) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`https://slack.com/api/${method}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const json = (await res.json()) as Record<string, unknown>;
    if (!json.ok) logger.warn({ method, error: json.error }, "Slack API error");
    return json;
  } catch (err) {
    logger.warn({ err, method }, "Slack API call failed");
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function postViaWebhook(text: string, blocks?: unknown[]): Promise<boolean> {
  const url = (await slackCredentials()).webhookUrl;
  if (!url) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(blocks?.length ? { text, blocks } : { text }),
      signal: controller.signal,
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, "Slack webhook non-2xx");
      return false;
    }
    return true;
  } catch (err) {
    logger.warn({ err }, "Slack webhook call failed");
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// Successful email → Slack-id lookups are cached for the process lifetime
// (Slack ids never change); misses are retried after a short TTL so someone
// who joins the workspace later doesn't stay unreachable until a redeploy.
// Keyed by bot token as well as email: each tenant has its own Slack, and the
// same email can be a different Slack user in each.
const MISS_TTL_MS = 5 * 60 * 1000;
const emailToId = new Map<string, { id: string | null; at: number }>();
async function slackIdForEmail(email: string): Promise<string | null> {
  if (!email) return null;
  const token = (await slackCredentials()).botToken;
  if (!token) return null;
  const cacheKey = `${token}:${email}`;
  const hit = emailToId.get(cacheKey);
  if (hit && (hit.id !== null || Date.now() - hit.at < MISS_TTL_MS)) {
    return hit.id;
  }
  // users.lookupByEmail rejects JSON bodies (invalid_arguments) — it is one
  // of the Slack Web API methods that only accepts querystring/form encoding.
  const res = await slackApiGet("users.lookupByEmail", { email });
  const id =
    res?.ok && res.user
      ? String((res.user as Record<string, unknown>).id)
      : null;
  emailToId.set(cacheKey, { id, at: Date.now() });
  return id;
}

async function slackApiGet(
  method: string,
  params: Record<string, string>,
): Promise<Record<string, unknown> | null> {
  const token = (await slackCredentials()).botToken;
  if (!token) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(`https://slack.com/api/${method}?${qs}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    const json = (await res.json()) as Record<string, unknown>;
    if (!json.ok) logger.warn({ method, error: json.error }, "Slack API error");
    return json;
  } catch (err) {
    logger.warn({ err, method }, "Slack API call failed");
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Deliver one resolved intent. Never throws. Returns whether the send was
 *  actually delivered — false when it was skipped (no token / no Slack user)
 *  or the Slack/webhook call failed — so callers can tell a real delivery from
 *  a no-op (the scheduler uses this to retry a reminder that didn't get out). */
async function deliver(intent: SlackIntent): Promise<boolean> {
  const { target, text, blocks } = intent;
  const hasBot = !!(await slackCredentials()).botToken;
  const payload = blocks?.length ? { text, blocks } : { text };

  if (target.kind === "channel") {
    // chat.postMessage wants a bare channel name or id — people type "#name".
    const channel = target.channel.replace(/^#/, "");
    if (STUB) {
      stubCapture(
        `channel:${channel || "(webhook)"}${blocks?.length ? " [card]" : ""}`,
        text,
      );
      return true;
    }
    if (hasBot && channel) {
      const r = await slackApi("chat.postMessage", { channel, ...payload });
      return !!r?.ok;
    }
    // No bot token, or no explicit channel → the fixed webhook channel.
    return postViaWebhook(text, blocks);
  }

  // DM by email — needs the bot token to resolve the id and open the DM.
  if (STUB) {
    stubCapture(
      `dm:${target.email}${blocks?.length ? " [card]" : ""}`,
      text,
    );
    return true;
  }
  if (!hasBot) {
    logger.warn({ email: target.email }, "Slack DM needs a bot token — skipped");
    return false;
  }
  const id = await slackIdForEmail(target.email);
  if (!id) {
    logger.warn({ email: target.email }, "No Slack user for email — DM skipped");
    return false;
  }
  // chat.postMessage accepts a user id as `channel` and opens the DM itself.
  const r = await slackApi("chat.postMessage", { channel: id, ...payload });
  return !!r?.ok;
}

/**
 * Fire a batch of resolved intents, best-effort, in parallel. Never rejects
 * (each delivery catches its own errors), so callers fire-and-forget — the
 * HTTP response doesn't wait on Slack (worst case was the 5s timeout).
 * Returns true only if every intent was actually delivered (true for an empty
 * batch); callers that don't care can ignore it.
 */
export async function fireSlackMessages(intents: SlackIntent[]): Promise<boolean> {
  if (intents.length === 0) return true;
  // allSettled (not all) so one delivery throwing can't reject this
  // fire-and-forget promise into an unhandled rejection — matches notify().
  const results = await Promise.allSettled(intents.map((i) => deliver(i)));
  return results.every((r) => r.status === "fulfilled" && r.value);
}

// Placeholder rendering for automation messages. Templates use
// {{scope.field}} (e.g. {{deal.title}}, {{deal.stage}}); only whitelisted
// fields per scope (TEMPLATE_FIELDS, from @workspace/automation-placeholders)
// resolve — unknown placeholders render blank, so a template can never leak
// arbitrary columns.

/** Render a template against named variable scopes. Whitespace inside braces
 *  is tolerated; unknown/empty fields become "". Substituted *values* are
 *  mrkdwn-escaped so user-controlled data (e.g. a deal titled "<!channel>")
 *  can't inject broadcast pings or masked links; the template's own text
 *  (the author's `*bold*`, etc.) is left intact. Downstream card builders
 *  therefore must NOT escape this output a second time. */
export function renderAutomationTemplate(
  template: string,
  scopes: Record<string, Record<string, unknown>>,
): string {
  return template.replace(
    /\{\{\s*(\w+)\.(\w+)\s*\}\}/g,
    (_, scope: string, field: string) => {
      if (!TEMPLATE_FIELDS[scope]?.includes(field)) return "";
      const v = scopes[scope]?.[field];
      return v == null ? "" : mrkdwnEscape(String(v));
    },
  );
}

/**
 * Post to the team's announcements channel (notifications controller: deal
 * won posts, reminder digests). Uses the workspace's announce channel via the
 * bot token when both are set, else falls back to the incoming webhook's
 * fixed channel.
 * Never throws — announcements are best-effort by design. Returns whether the
 * post was actually delivered.
 */
export async function sendSlackMessage(text: string): Promise<boolean> {
  return deliver({
    target: {
      kind: "channel",
      channel: (await getSetting(ANNOUNCE_CHANNEL_KEY)) ?? "",
    },
    text,
  });
}

// ---- Channel picker (automation wizard) ----------------------------------
export interface WorkspaceChannel {
  id: string;
  name: string;
  isPrivate: boolean;
  isMember: boolean;
}
export interface WorkspaceChannelsResult {
  available: boolean;
  channels: WorkspaceChannel[];
}

const CHANNEL_TTL_MS = 60 * 1000;
// Keyed by bot token: one entry per connected Slack workspace.
const channelCache = new Map<
  string,
  { at: number; value: WorkspaceChannelsResult }
>();

/**
 * List the workspace's channels for the wizard's channel picker. Degrades
 * gracefully: with no bot token, without the channels:read/groups:read scope
 * (missing_scope), or on any Slack error it returns available=false so the
 * wizard falls back to a free-text channel field. Never throws.
 */
export async function listWorkspaceChannels(): Promise<WorkspaceChannelsResult> {
  if (STUB) {
    return {
      available: true,
      channels: [
        { id: "C1", name: "ai-team-projects", isPrivate: false, isMember: true },
        { id: "C2", name: "sales-wins", isPrivate: false, isMember: true },
        { id: "C3", name: "cs-managers", isPrivate: true, isMember: false },
      ],
    };
  }
  const token = (await slackCredentials()).botToken;
  if (!token) return { available: false, channels: [] };
  const cached = channelCache.get(token);
  if (cached && Date.now() - cached.at < CHANNEL_TTL_MS) {
    return cached.value;
  }
  // Follow Slack's cursor pagination — one page misses larger workspaces.
  // Ask for Slack's maximum page size: pages come back sparse (well under
  // `limit`, since archived/filtered channels still consume it), and at 200
  // our workspace needed 14 pages, past the 10-page cap, so later channels
  // were missing from the picker. At 1000 it
  // takes 3, which also keeps us clear of this Tier 2 method's rate limit.
  const raw: Record<string, unknown>[] = [];
  let cursor = "";
  for (let page = 0; page < 10; page++) {
    // conversations.list is a GET-style method — JSON bodies are ignored
    // (same Slack quirk as users.lookupByEmail), so use the query caller.
    const res = await slackApiGet("conversations.list", {
      types: "public_channel,private_channel",
      exclude_archived: "true",
      limit: "1000",
      ...(cursor ? { cursor } : {}),
    });
    if (!res?.ok || !Array.isArray(res.channels)) {
      // missing_scope (channels:read/groups:read) or any error — fall back.
      if (res?.error)
        logger.debug({ error: res.error }, "conversations.list unavailable");
      return { available: false, channels: [] };
    }
    raw.push(...(res.channels as Record<string, unknown>[]));
    cursor = String(
      (res.response_metadata as Record<string, unknown> | undefined)
        ?.next_cursor ?? "",
    );
    if (!cursor) break;
  }
  const channels: WorkspaceChannel[] = raw
    .map((c) => ({
      id: String(c.id),
      name: String(c.name ?? ""),
      isPrivate: !!c.is_private,
      isMember: !!c.is_member,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const value: WorkspaceChannelsResult = { available: true, channels };
  channelCache.set(token, { at: Date.now(), value });
  return value;
}

/**
 * Deliver a private test to a single user (by their email → Slack id). Used by
 * the wizard's "send test" button so setup can be verified without posting to
 * the real channel. Reports a human-readable outcome for the wizard toast.
 */
export async function sendTestMessageToUser(
  email: string,
  text: string,
  blocks?: unknown[],
): Promise<{ delivered: boolean; detail: string }> {
  if (STUB) {
    stubCapture(`dm:${email || "(you)"}${blocks?.length ? " [card]" : ""}`, text);
    return { delivered: true, detail: "Test sent to you in Slack." };
  }
  if (!(await slackCredentials()).botToken) {
    return {
      delivered: false,
      detail: "Slack isn't connected yet (no bot token), so a test can't be sent.",
    };
  }
  if (!email) {
    return {
      delivered: false,
      detail: "Your account has no email on file, so we can't open your Slack DM.",
    };
  }
  const id = await slackIdForEmail(email);
  if (!id) {
    return {
      delivered: false,
      detail: `No Slack account matches ${email}. Ask an admin to check the email on your user, then try again.`,
    };
  }
  const res = await slackApi("chat.postMessage", {
    channel: id,
    ...(blocks?.length ? { text, blocks } : { text }),
  });
  return res?.ok
    ? { delivered: true, detail: "Test sent to you in Slack. Check your DMs." }
    : { delivered: false, detail: "Slack rejected the test message." };
}

/**
 * Announce (once) that someone created a channel-posting automation, in that
 * channel. Best-effort; reuses the channel-send path (bot or webhook, '#'
 * stripped, stub-aware). Rendered as mrkdwn so names read bold in Slack.
 */
export async function announceAutomationCreated(
  channel: string,
  creatorName: string,
  automationName: string,
  triggerPhrase: string,
): Promise<void> {
  // creatorName / automationName are user-controlled — escape before they
  // reach Slack. triggerPhrase is code-generated, so it's left as-is.
  const who = mrkdwnEscape(creatorName);
  const name = mrkdwnEscape(automationName);
  const text = `🔧 ${who} set up a new automation: “${name}”. This channel will now get a message when ${triggerPhrase}.`;
  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `🔧 *${who}* set up a new automation: *“${name}”*. This channel will now get a message when ${triggerPhrase}.`,
      },
    },
  ];
  await fireSlackMessages([{ target: { kind: "channel", channel }, text, blocks }]);
}

// ---- Block Kit cards (the "beautiful message" layer) ----------------------
// The user's rendered message is the headline; key facts follow as a fields
// grid; deep-link buttons appear when APP_BASE_URL is configured. `text` on
// the intent stays the plain fallback for notifications/old clients.

export interface DealCardFacts {
  valueText: string | null;
  ownerName: string | null;
  pipelineName: string | null;
  organizationName: string | null;
  dealId: number | null;
}

/** Escape the characters Slack treats specially in mrkdwn (`&`, `<`, `>`), so
 *  user text can't inject `<!channel>` broadcasts or `<url|masked>` links.
 *  Exported for the notification announcements that build their own text. */
export function mrkdwnEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function baseUrl(): string | null {
  const u = process.env.APP_BASE_URL?.replace(/\/$/, "");
  return u || null;
}

export function buildDealCardBlocks(
  headline: string,
  facts: DealCardFacts,
): unknown[] {
  // headline comes from renderAutomationTemplate, which already escapes
  // substituted values — escaping again here would double-escape (users would
  // see `&lt;`). Fact values below are raw, so they still get escaped.
  const blocks: unknown[] = [
    {
      type: "section",
      text: { type: "mrkdwn", text: headline },
    },
  ];
  const fields = [
    facts.valueText && { type: "mrkdwn", text: `*Value*\n${mrkdwnEscape(facts.valueText)}` },
    facts.ownerName && { type: "mrkdwn", text: `*Owner*\n${mrkdwnEscape(facts.ownerName)}` },
    facts.pipelineName && { type: "mrkdwn", text: `*Pipeline*\n${mrkdwnEscape(facts.pipelineName)}` },
    facts.organizationName && {
      type: "mrkdwn",
      text: `*Organization*\n${mrkdwnEscape(facts.organizationName)}`,
    },
  ].filter(Boolean);
  if (fields.length) blocks.push({ type: "section", fields });
  const base = baseUrl();
  if (base) {
    const elements: unknown[] = [];
    if (facts.dealId != null) {
      elements.push({
        type: "button",
        style: "primary",
        text: { type: "plain_text", text: "Open deal" },
        url: `${base}/deal/${facts.dealId}`,
      });
    }
    elements.push({
      type: "button",
      text: { type: "plain_text", text: "View pipeline" },
      url: `${base}/deals`,
    });
    blocks.push({ type: "actions", elements });
  }
  return blocks;
}
