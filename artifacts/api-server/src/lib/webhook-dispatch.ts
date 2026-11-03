import type {
  AutomationTriggerEvent,
  CallWebhookConfig,
  Deal,
} from "@workspace/db";
import { getWebhookSecret } from "./app-settings";
import { loadDealForWebhook } from "./queries";
import { logger } from "./logger";

// A pending outbound webhook call, collected during the deal-write transaction
// and fired AFTER it commits. Outbound HTTP must never run inside the DB
// transaction (a slow endpoint would hold it open) nor block the user's
// response — every call is best-effort and logged, never awaited for success.

export interface WebhookIntent {
  config: CallWebhookConfig;
  event: AutomationTriggerEvent;
  deal?: Deal;
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
  const { config, event, deal, automationId, automationName } = intent;
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

  const body = JSON.stringify({
    event,
    automationId,
    automationName,
    firedAt: new Date().toISOString(),
    deal: dealPayload ?? null,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(config.url, {
      method: config.method,
      headers,
      body,
      signal: controller.signal,
    });
    if (!res.ok) {
      logger.warn(
        { automationId, url: config.url, status: res.status },
        "webhook returned non-2xx",
      );
    }
  } catch (err) {
    logger.warn({ err, automationId, url: config.url }, "webhook call failed");
  } finally {
    clearTimeout(timer);
  }
}
