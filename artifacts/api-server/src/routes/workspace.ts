import { Router, type IRouter } from "express";
import {
  GetWorkspaceResponse,
  UpdateWorkspaceBody,
  UpdateWorkspaceResponse,
} from "@workspace/api-zod";
import { currentUser, requireAdmin } from "../lib/auth";
import { getTenant, renameTenant } from "../lib/tenants";
import {
  RegionalSettingsError,
  saveRegionalSettings,
  toWorkspaceDto,
  validateRegionalUpdate,
} from "../lib/workspace-settings";

const router: IRouter = Router();

// The tenant id always comes from the session, never from the request, so
// these routes can only ever read or change the caller's own workspace.
router.get("/workspace", async (_req, res): Promise<void> => {
  const tenant = await getTenant(currentUser(res).tenantId);
  if (!tenant) {
    res.status(404).json({ error: "Workspace not found" });
    return;
  }
  res.json(GetWorkspaceResponse.parse(toWorkspaceDto(tenant)));
});

router.patch("/workspace", requireAdmin, async (req, res): Promise<void> => {
  const parsed = UpdateWorkspaceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const tenantId = currentUser(res).tenantId;
  const { name, ...regionalInput } = parsed.data;
  // Validate everything before writing anything, so a bad field never leaves
  // the name changed and the settings not.
  let regional;
  try {
    regional = await validateRegionalUpdate(regionalInput);
  } catch (err) {
    if (err instanceof RegionalSettingsError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
  if (name !== undefined) await renameTenant(tenantId, name);
  await saveRegionalSettings(tenantId, regional);
  const tenant = await getTenant(tenantId);
  if (!tenant) {
    res.status(404).json({ error: "Workspace not found" });
    return;
  }
  res.json(UpdateWorkspaceResponse.parse(toWorkspaceDto(tenant)));
});

export default router;
