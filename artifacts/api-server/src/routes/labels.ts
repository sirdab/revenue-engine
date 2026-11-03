import { Router, type IRouter } from "express";
import {
  ListLabelsQueryParams,
  ListLabelsResponse,
  ListLostReasonsResponse,
} from "@workspace/api-zod";
import { listLabelOptions } from "../lib/labels";
import { adminListLostReasons } from "../lib/lost-reasons";

// Read-only taxonomy endpoints for pickers (any authenticated user).
// Admin management lives in routes/admin-labels.ts.

const router: IRouter = Router();

router.get("/labels", async (req, res): Promise<void> => {
  const parsed = ListLabelsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const options = await listLabelOptions(parsed.data.entity);
  res.json(ListLabelsResponse.parse(options));
});

router.get("/lost-reasons", async (_req, res): Promise<void> => {
  const { reasons } = await adminListLostReasons();
  res.json(ListLostReasonsResponse.parse(reasons.filter((r) => r.active)));
});

export default router;
