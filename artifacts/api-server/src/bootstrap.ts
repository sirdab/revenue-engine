import { db, pool, usersTable, runAsSystem } from "@workspace/db";
import { eq } from "drizzle-orm";
import { validatePasswordStrength } from "./lib/auth";
import { logger } from "./lib/logger";
import { createWorkspace } from "./lib/tenants";

/**
 * Safe, idempotent production bootstrap.
 *
 * Unlike the demo seed (which wipes every table), this only ensures one admin
 * account exists, created from secrets and never deleting any data. Run once
 * after deploying:
 *
 *   BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_PASSWORD, [BOOTSTRAP_ADMIN_NAME],
 *   [BOOTSTRAP_WORKSPACE_NAME]
 *
 * If the user does not exist, a new workspace is created with them as its
 * admin (the same path as self-serve sign-up). If they already exist they are
 * ensured to be an active admin of their workspace; the existing password is
 * left untouched (rotate it through the app instead).
 */
async function bootstrap(): Promise<void> {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.toLowerCase().trim();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  const name = process.env.BOOTSTRAP_ADMIN_NAME?.trim() || "Administrator";
  const workspaceName =
    process.env.BOOTSTRAP_WORKSPACE_NAME?.trim() || "My workspace";

  if (!email || !password) {
    throw new Error(
      "BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD are required.",
    );
  }
  const pwError = validatePasswordStrength(password);
  if (pwError) {
    throw new Error(`BOOTSTRAP_ADMIN_PASSWORD is too weak: ${pwError}`);
  }

  const [existing] = await runAsSystem(() =>
    db.select().from(usersTable).where(eq(usersTable.email, email)),
  );

  if (existing) {
    await runAsSystem(() =>
      db
        .update(usersTable)
        .set({ isAdmin: true, activeFlag: true })
        .where(eq(usersTable.id, existing.id)),
    );
    logger.info(
      { email },
      "Bootstrap: existing user ensured as active admin (password unchanged)",
    );
  } else {
    const { tenant } = await createWorkspace({ workspaceName, name, email, password });
    logger.info(
      { email, workspace: tenant.slug },
      "Bootstrap: workspace and admin user created",
    );
  }
}

bootstrap()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    logger.error({ err }, "Bootstrap failed");
    await pool.end().catch(() => {});
    process.exit(1);
  });
