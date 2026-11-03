import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { slackOutbox } from "../lib/slack";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

// Local-dev only (SLACK_STUB=1): inspect the messages the Slack action would
// have sent, without a real Slack workspace. Never mounted in production.
if (process.env.SLACK_STUB === "1") {
  router.get("/dev/slack-outbox", (_req, res) => {
    res.json({ messages: slackOutbox() });
  });
}

export default router;
