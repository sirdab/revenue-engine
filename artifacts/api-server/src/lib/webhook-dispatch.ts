import type {
  AutomationTriggerEvent,
  CallWebhookConfig,
  Deal,
} from "@workspace/db";
import { getWebhookSecret } from "./app-settings";
import { loadDealForWebhook } from "./queries";
import { logger } from "./logger";
import {
  allowPrivateWebhookTargets,
  sendToWebhook,
  webhookUrlProblem,
} from "./outbound-guard";

// A pending outbound webhook call, collected during the deal-write transaction
// and fired AFTER it commits. Outbound HTTP must never run inside the DB
// transaction (a slow endpoint would hold it open) nor block the user's
// response — every call is best-effort and logged, never awaited for success.

/** The account subject an account-triggered webhook carries instead of a deal. */
export interface WebhookAccountSubject {
  orgId: number;
  stage: string | null;
  previousStage: string | null;
  accountManager: string | null;
  /** Secondary owner label for the account, or null. */
  collectionsOwner: string | null;
}

export interface WebhookIntent {
  config: CallWebhookConfig;
  event: AutomationTriggerEvent;
  /**
   * Exactly one of `deal` / `account` is set, by trigger:
   *   deal_added / deal_updated  -> deal
   *   (account triggers)         -> account — none are defined at present
   *
   * The payload shape follows, so an external consumer must branch on `event`
   * rather than assume `deal` is always present. Kept as two optional fields
   * instead of a discriminated union because the config, ids and firing path are
   * identical — only the body differs.
   */
  deal?: Deal;
  account?: WebhookAccountSubject;
  automationId: number;
  automationName: string;
}

const TIMEOUT_MS = 5000;

/** Fire every collected webhook, best-effort. Never throws. */
export async function fireWebhooks(intents: WebhookIntent[]): Promise<void> {
  if (intents.length === 0) return;
  const secret = await getWebhookSecret();
  await Promise.all(intents.map((intent) => fireOne(intent, secret)));
}

async function fireOne(
  intent: WebhookIntent,
  secret: string | null,
): Promise<void> {
  const { config, event, deal, account, automationId, automationName } = intent;
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (config.secretHeaderName) {
    if (secret) {
      headers[config.secretHeaderName] = secret;
    } else {
      logger.warn(
        { automationId, url: config.url },
        "webhook secret header configured but no integration secret set; sending without it",
      );
    }
  }

  // Denormalize the deal (owner/person contact details, org/stage names) at
  // fire time — safe here because webhooks run post-commit, outside the tx.
  // A failed/missing enrichment must never block the send: fall back to the
  // flat row already on the intent.
  let dealPayload: unknown;
  if (config.includeDeal && deal) {
    dealPayload = deal;
    try {
      const enriched = await loadDealForWebhook(deal.id);
      if (enriched) dealPayload = enriched;
    } catch (err) {
      logger.warn(
        { err, automationId, dealId: deal.id },
        "webhook deal enrichment failed; sending flat deal row",
      );
    }
  }

  // `deal` stays in the body for deal triggers (unchanged contract) and
  // `account` appears for account triggers. Both keys are always present so a
  // consumer can read one and find null rather than a missing property.
  const body = JSON.stringify({
    event,
    automationId,
    automationName,
    firedAt: new Date().toISOString(),
    deal: dealPayload ?? null,
    account: config.includeDeal ? (account ?? null) : null,
  });

  // Checked when the automation was saved, and again here: the rule may be
  // newer than the automation, and the setting may have changed since.
  const allowPrivate = allowPrivateWebhookTargets();
  const problem = webhookUrlProblem(config.url, { allowPrivate });
  if (problem) {
    logger.warn({ automationId, url: config.url, problem }, "webhook not sent");
    return;
  }
  try {
    const status = await sendToWebhook(
      config.url,
      { method: config.method, headers, body },
      { allowPrivate, timeoutMs: TIMEOUT_MS },
    );
    if (status < 200 || status >= 300) {
      logger.warn(
        { automationId, url: config.url, status },
        "webhook returned non-2xx",
      );
    }
  } catch (err) {
    logger.warn({ err, automationId, url: config.url }, "webhook call failed");
  }
}
