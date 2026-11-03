import { and, asc, eq, ilike } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";

// Who owns a deal that arrives from a machine (the lead webhook or the
// deal-update webhook) when no human picked one.

export interface OwnerRow {
  id: number;
  defaultCurrency: string;
}

// Payload ownerEmail -> WEBHOOK_DEFAULT_OWNER_EMAIL env -> first ACTIVE admin.
// Every step only accepts an active user: an email that names a deactivated
// user falls through to the next option rather than hand a new lead to
// somebody who no longer signs in.
export async function resolveOwner(email?: string): Promise<OwnerRow | null> {
  const byEmail = async (e: string): Promise<OwnerRow | undefined> => {
    const [u] = await db
      .select({ id: usersTable.id, defaultCurrency: usersTable.defaultCurrency })
      .from(usersTable)
      .where(and(ilike(usersTable.email, e), eq(usersTable.activeFlag, true)))
      .limit(1);
    return u;
  };
  if (email) {
    const u = await byEmail(email);
    if (u) return u;
  }
  const envEmail = process.env.WEBHOOK_DEFAULT_OWNER_EMAIL;
  if (envEmail) {
    const u = await byEmail(envEmail);
    if (u) return u;
  }
  const [admin] = await db
    .select({ id: usersTable.id, defaultCurrency: usersTable.defaultCurrency })
    .from(usersTable)
    .where(and(eq(usersTable.isAdmin, true), eq(usersTable.activeFlag, true)))
    .orderBy(asc(usersTable.id))
    .limit(1);
  return admin ?? null;
}
