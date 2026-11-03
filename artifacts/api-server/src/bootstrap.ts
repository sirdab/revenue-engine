import { db, pool, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { hashPassword, validatePasswordStrength } from "./lib/auth";
import { logger } from "./lib/logger";

/**
 * Safe, idempotent production bootstrap.
 *
 * Unlike the demo seed (which wipes every table), this only ensures a single
 * admin account exists, created from secrets and never deleting any data. Run
 * once after deploying:
 *
 *   BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_PASSWORD, [BOOTSTRAP_ADMIN_NAME]
 *
 * If the user already exists it is ensured to be an active admin; the existing
 * password is left untouched (rotate it through the app instead).
 */
async function bootstrap(): Promise<void> {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.toLowerCase().trim();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  const name = process.env.BOOTSTRAP_ADMIN_NAME?.trim() || "Administrator";

  if (!email || !password) {
    throw new Error(
      "BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD are required.",
    );
  }
  const pwError = validatePasswordStrength(password);
  if (pwError) {
    throw new Error(`BOOTSTRAP_ADMIN_PASSWORD is too weak: ${pwError}`);
  }

  const [existing] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email));

  if (existing) {
    await db
      .update(usersTable)
      .set({ isAdmin: true, activeFlag: true })
      .where(eq(usersTable.id, existing.id));
    logger.info(
      { email },
      "Bootstrap: existing user ensured as active admin (password unchanged)",
    );
  } else {
    const passwordHash = await hashPassword(password);
    await db.insert(usersTable).values({
      name,
      email,
      passwordHash,
      isAdmin: true,
    });
    logger.info({ email }, "Bootstrap: admin user created");
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
