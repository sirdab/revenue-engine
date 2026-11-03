import { Router, type IRouter } from "express";
import { requireAdmin } from "../lib/auth";
import { ensureWebhookSecret, rotateWebhookSecret } from "../lib/app-settings";

const router: IRouter = Router();

// Admin-only management of the inbound-webhook shared secret used by n8n
// (Settings → Integrations). Mounted in the authenticated section.

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

export default router;
