import { Router, type IRouter } from "express";
import {
  DismissOnboardingBody,
  GetOnboardingResponse,
  LoadSampleDataBody,
} from "@workspace/api-zod";
import { currentUser, requireAdmin } from "../lib/auth";
import {
  getOnboardingStatus,
  loadSampleData,
  removeSampleData,
  SampleDataError,
  setOnboardingDismissed,
} from "../lib/onboarding";

const router: IRouter = Router();

// The getting-started checklist on Home. Admin-only: its steps (region, import,
// invites) are admin actions, and sample data writes for the whole workspace.

async function sendStatus(res: Parameters<typeof currentUser>[0]): Promise<void> {
  const status = await getOnboardingStatus(currentUser(res).tenantId);
  res.json(GetOnboardingResponse.parse(status));
}

router.get("/onboarding", requireAdmin, async (_req, res): Promise<void> => {
  await sendStatus(res);
});

router.post("/onboarding/dismiss", requireAdmin, async (req, res): Promise<void> => {
  const parsed = DismissOnboardingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  await setOnboardingDismissed(parsed.data.dismissed);
  await sendStatus(res);
});

router.post("/onboarding/sample-data", requireAdmin, async (req, res): Promise<void> => {
  const parsed = LoadSampleDataBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    await loadSampleData(currentUser(res).id, parsed.data.locale);
  } catch (err) {
    if (err instanceof SampleDataError) {
      res.status(409).json({ error: err.message });
      return;
    }
    throw err;
  }
  await sendStatus(res);
});

router.delete("/onboarding/sample-data", requireAdmin, async (_req, res): Promise<void> => {
  await removeSampleData(currentUser(res).id);
  await sendStatus(res);
});

export default router;
