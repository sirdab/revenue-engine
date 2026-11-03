import { Router, type IRouter } from "express";
import { requireAdmin } from "../lib/auth";
import { ensureWebhookSecret, rotateWebhookSecret } from "../lib/app-settings";
import {
  getSlackSettings,
  updateSlackSettings,
  SlackSettingsError,
} from "../lib/slack";

const router: IRouter = Router();

// Admin-only management of the workspace's integrations (Settings →
// Integrations): the inbound-webhook shared secret and the Slack connection.
// Mounted in the authenticated section, so every read and write here is the
// signed-in admin's own workspace.

router.get(
  "/settings/webhook-secret",
  requireAdmin,
  async (_req, res): Promise<void> => {
    const secret = await ensureWebhookSecret();
    res.json({ secret });
  },
);

router.post(
  "/settings/webhook-secret/rotate",
  requireAdmin,
  async (_req, res): Promise<void> => {
    const secret = await rotateWebhookSecret();
    res.json({ secret });
  },
);

router.get(
  "/settings/slack",
  requireAdmin,
  async (_req, res): Promise<void> => {
    res.json(await getSlackSettings());
  },
);

// Write-only secrets: the response says whether each is set, never its value.
router.put(
  "/settings/slack",
  requireAdmin,
  async (req, res): Promise<void> => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const field = (k: string): string | null | undefined => {
      const v = body[k];
      if (v === undefined || v === null) return v;
      return typeof v === "string" ? v : undefined;
    };
    try {
      res.json(
        await updateSlackSettings({
          botToken: field("botToken"),
          webhookUrl: field("webhookUrl"),
          announceChannel: field("announceChannel"),
        }),
      );
    } catch (err) {
      if (err instanceof SlackSettingsError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

export default router;
