import { Router, type IRouter } from "express";
import { requireAdmin } from "../lib/auth";
import { ensureWebhookSecret, rotateWebhookSecret } from "../lib/app-settings";
import {
  AiSettingsError,
  getAiSettings,
  testAiConnection,
  updateAiSettings,
} from "../lib/ai-settings";
import {
  getSlackSettings,
  updateSlackSettings,
  SlackSettingsError,
} from "../lib/slack";

const router: IRouter = Router();

// Admin-only management of the workspace's integrations (Settings →
// Integrations): the inbound-webhook shared secret, the Slack connection and
// the AI assistant's provider key.
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

// The AI assistant's connection. The key is write-only: the response says
// whether one is stored, never its value.
router.get(
  "/settings/ai",
  requireAdmin,
  async (_req, res): Promise<void> => {
    res.json(await getAiSettings());
  },
);

router.put(
  "/settings/ai",
  requireAdmin,
  async (req, res): Promise<void> => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const str = (k: string): string | null | undefined => {
      const v = body[k];
      if (v === undefined || v === null) return v;
      return typeof v === "string" ? v : undefined;
    };
    try {
      res.json(
        await updateAiSettings({
          provider: typeof body.provider === "string" ? (body.provider as "openai" | "anthropic") : undefined,
          apiKey: str("apiKey"),
          model: str("model"),
          enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
        }),
      );
    } catch (err) {
      if (err instanceof AiSettingsError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

router.post(
  "/settings/ai/test",
  requireAdmin,
  async (_req, res): Promise<void> => {
    res.json(await testAiConnection());
  },
);

export default router;
