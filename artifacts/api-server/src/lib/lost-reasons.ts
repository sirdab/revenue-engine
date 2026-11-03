import { and, asc, eq, ne, sql } from "drizzle-orm";
import { db, dealsTable, lostReasonsTable, type LostReason } from "@workspace/db";
import { LabelError } from "./labels";

// Managed lost reasons service.
//
// deals.lost_reason stays a plain string (reps may enter one-off custom
// reasons), so this service reconciles two views: the curated list here and
// the strings actually on lost deals. Renames rewrite matching deal strings —
// case-insensitively — so reporting stays consistent; deletes leave history
// alone, which simply resurfaces the string under "unmanaged" if it's in use.

export interface LostReasonWithUsage extends LostReason {
  usageCount: number;
}
export interface UnmanagedLostReason {
  name: string;
  usageCount: number;
}

// Distinct reasons on lost deals, keyed case-insensitively with the first
// spelling kept for display.
async function usageByReason(): Promise<Map<string, UnmanagedLostReason>> {
  const result = await db.execute<{ name: string; count: number }>(sql`
    select min(${dealsTable.lostReason}) as name, count(*)::int as count
    from ${dealsTable}
    where ${dealsTable.status} = 'lost' and ${dealsTable.lostReason} is not null
    group by lower(${dealsTable.lostReason})
  `);
  const map = new Map<string, UnmanagedLostReason>();
  for (const row of result.rows) {
    map.set(row.name.toLowerCase(), {
      name: row.name,
      usageCount: Number(row.count),
    });
  }
  return map;
}

/** All managed reasons with usage + reasons on lost deals nobody manages. */
export async function adminListLostReasons(): Promise<{
  reasons: LostReasonWithUsage[];
  unmanaged: UnmanagedLostReason[];
}> {
  const [rows, usage] = await Promise.all([
    db
      .select()
      .from(lostReasonsTable)
      .orderBy(
        asc(lostReasonsTable.orderIndex),
        asc(sql`lower(${lostReasonsTable.name})`),
      ),
    usageByReason(),
  ]);
  const managed = new Set(rows.map((r) => r.name.toLowerCase()));
  const reasons = rows.map((r) => ({
    ...r,
    usageCount: usage.get(r.name.toLowerCase())?.usageCount ?? 0,
  }));
  const unmanaged = [...usage.values()]
    .filter((u) => !managed.has(u.name.toLowerCase()))
    .sort(
      (a, b) => b.usageCount - a.usageCount || a.name.localeCompare(b.name),
    );
  return { reasons, unmanaged };
}

async function withUsage(reason: LostReason): Promise<LostReasonWithUsage> {
  const usage = await usageByReason();
  return {
    ...reason,
    usageCount: usage.get(reason.name.toLowerCase())?.usageCount ?? 0,
  };
}

/** Add a reason; re-adding an archived reason's name reactivates it instead. */
export async function createLostReason(
  name: string,
): Promise<LostReasonWithUsage> {
  const trimmed = name.trim();
  if (!trimmed) throw new LabelError(400, "Reason cannot be empty.");
  const [existing] = await db
    .select()
    .from(lostReasonsTable)
    .where(sql`lower(${lostReasonsTable.name}) = lower(${trimmed})`);
  if (existing) {
    if (existing.active) {
      throw new LabelError(409, `The reason “${existing.name}” already exists.`);
    }
    const [revived] = await db
      .update(lostReasonsTable)
      .set({ active: true })
      .where(eq(lostReasonsTable.id, existing.id))
      .returning();
    return withUsage(revived);
  }
  const [{ next }] = (
    await db.execute<{ next: number }>(
      sql`select coalesce(max(order_index), 0) + 1 as next from ${lostReasonsTable}`,
    )
  ).rows;
  const [created] = await db
    .insert(lostReasonsTable)
    .values({ name: trimmed, orderIndex: Number(next) })
    .returning();
  return withUsage(created);
}

/** Rename / reorder / archive. Renames rewrite the reason on every deal. */
export async function updateLostReason(
  id: number,
  patch: { name?: string; active?: boolean; orderIndex?: number },
): Promise<LostReasonWithUsage> {
  const updated = await db.transaction(async (tx) => {
    const [reason] = await tx
      .select()
      .from(lostReasonsTable)
      .where(eq(lostReasonsTable.id, id));
    if (!reason) throw new LabelError(404, "Lost reason not found.");

    const nextName = patch.name?.trim();
    if (nextName !== undefined && nextName === "") {
      throw new LabelError(400, "Reason cannot be empty.");
    }

    if (nextName && nextName !== reason.name) {
      const [collision] = await tx
        .select({ id: lostReasonsTable.id })
        .from(lostReasonsTable)
        .where(
          and(
            sql`lower(${lostReasonsTable.name}) = lower(${nextName})`,
            ne(lostReasonsTable.id, reason.id),
          ),
        );
      if (collision) {
        throw new LabelError(409, "Another reason already uses this name.");
      }
      await tx
        .update(dealsTable)
        .set({ lostReason: nextName })
        .where(sql`lower(${dealsTable.lostReason}) = lower(${reason.name})`);
    }

    const [row] = await tx
      .update(lostReasonsTable)
      .set({
        ...(nextName ? { name: nextName } : {}),
        ...(patch.active !== undefined ? { active: patch.active } : {}),
        ...(patch.orderIndex !== undefined
          ? { orderIndex: patch.orderIndex }
          : {}),
      })
      .where(eq(lostReasonsTable.id, reason.id))
      .returning();
    return row;
  });
  return withUsage(updated);
}

/** Remove a reason from the managed list; deal history is untouched. */
export async function deleteLostReason(id: number): Promise<void> {
  const [deleted] = await db
    .delete(lostReasonsTable)
    .where(eq(lostReasonsTable.id, id))
    .returning({ id: lostReasonsTable.id });
  if (!deleted) throw new LabelError(404, "Lost reason not found.");
}
