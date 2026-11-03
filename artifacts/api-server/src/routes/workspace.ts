import { Router, type IRouter } from "express";
import {
  GetWorkspaceResponse,
  UpdateWorkspaceBody,
  UpdateWorkspaceResponse,
} from "@workspace/api-zod";
import { currentUser, requireAdmin } from "../lib/auth";
import { getTenant, renameTenant } from "../lib/tenants";

const router: IRouter = Router();

const toWorkspace = (t: { id: number; name: string; slug: string }) => ({
  id: t.id,
  name: t.name,
  slug: t.slug,
});

// The tenant id always comes from the session, never from the request, so
// these routes can only ever read or rename the caller's own workspace.
router.get("/workspace", async (_req, res): Promise<void> => {
  const tenant = await getTenant(currentUser(res).tenantId);
  if (!tenant) {
    res.status(404).json({ error: "Workspace not found" });
    return;
  }
  res.json(GetWorkspaceResponse.parse(toWorkspace(tenant)));
});

router.patch("/workspace", requireAdmin, async (req, res): Promise<void> => {
  const parsed = UpdateWorkspaceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const tenant = await renameTenant(currentUser(res).tenantId, parsed.data.name);
  res.json(UpdateWorkspaceResponse.parse(toWorkspace(tenant)));
});

export default router;
