import { asc, eq, isNotNull, sql } from "drizzle-orm";
import { db, teamsTable, usersTable } from "@workspace/db";

// Teams service — the ownership grouping layer.
//
// Membership is one primary team per user via users.team_id; assigning a user to a team is a plain
// users update handled by the users route. This service owns team CRUD and the
// "team with its members" projection the admin panel reads.
//
// Deliberately NO name-uniqueness check: duplicate display names are
// tolerable for a grouping.

export class TeamError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface TeamMember {
  id: number;
  name: string;
  email: string;
}

export interface TeamWithMembers {
  id: number;
  name: string;
  active: boolean;
  orderIndex: number;
  memberCount: number;
  members: TeamMember[];
}

// A team for pickers/assignment — no member list, so member emails are never
// exposed to non-admins (the full member list is admin-only, see adminListTeams).
export type TeamOption = Omit<TeamWithMembers, "members">;

// Registry columns a Team projection reads. Kept as one shape so the three
// call sites (create / update / list) can't drift.
type TeamRow = Pick<
  TeamWithMembers,
  "id" | "name" | "active" | "orderIndex"
>;

function toTeam(row: TeamRow, members: TeamMember[]): TeamWithMembers {
  return { ...row, memberCount: members.length, members };
}

/** Members of a single team, ordered by name. */
async function membersOf(teamId: number): Promise<TeamMember[]> {
  return db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
    })
    .from(usersTable)
    .where(eq(usersTable.teamId, teamId))
    .orderBy(asc(usersTable.name));
}

/**
 * Active teams for pickers and future assignment rules — names + member counts
 * only, never the member list (which would leak member emails to non-admins).
 */
export async function listActiveTeams(): Promise<TeamOption[]> {
  const teams = await db
    .select({
      id: teamsTable.id,
      name: teamsTable.name,
      active: teamsTable.active,
      orderIndex: teamsTable.orderIndex,
    })
    .from(teamsTable)
    .where(eq(teamsTable.active, true))
    .orderBy(asc(teamsTable.orderIndex), asc(sql`lower(${teamsTable.name})`));

  const counts = await db
    .select({
      teamId: usersTable.teamId,
      count: sql<number>`count(*)::int`,
    })
    .from(usersTable)
    .where(isNotNull(usersTable.teamId))
    .groupBy(usersTable.teamId);
  const countByTeam = new Map(counts.map((c) => [c.teamId, Number(c.count)]));

  return teams.map((t) => ({ ...t, memberCount: countByTeam.get(t.id) ?? 0 }));
}

/** Every team (active and archived) with its members, for the admin panel. */
export async function adminListTeams(): Promise<TeamWithMembers[]> {
  const teams = await db
    .select({
      id: teamsTable.id,
      name: teamsTable.name,
      active: teamsTable.active,
      orderIndex: teamsTable.orderIndex,
    })
    .from(teamsTable)
    .orderBy(asc(teamsTable.orderIndex), asc(sql`lower(${teamsTable.name})`));

  const members = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      teamId: usersTable.teamId,
    })
    .from(usersTable)
    .where(isNotNull(usersTable.teamId))
    .orderBy(asc(usersTable.name));

  const byTeam = new Map<number, TeamMember[]>();
  for (const m of members) {
    if (m.teamId == null) continue;
    const arr = byTeam.get(m.teamId) ?? [];
    arr.push({ id: m.id, name: m.name, email: m.email });
    byTeam.set(m.teamId, arr);
  }

  return teams.map((t) => toTeam(t, byTeam.get(t.id) ?? []));
}

/** Create a team. No name-uniqueness check by design (see module doc). */
export async function createTeam(name: string): Promise<TeamWithMembers> {
  const trimmed = name.trim();
  if (!trimmed) throw new TeamError(400, "Team name cannot be empty.");
  const [{ next }] = (
    await db.execute<{ next: number }>(
      sql`select coalesce(max(order_index), 0) + 1 as next from ${teamsTable}`,
    )
  ).rows;
  const [created] = await db
    .insert(teamsTable)
    .values({ name: trimmed, orderIndex: Number(next) })
    .returning();
  return toTeam(created, []);
}

/** Rename, reorder, or archive a team. */
export async function updateTeam(
  id: number,
  patch: { name?: string; active?: boolean; orderIndex?: number },
): Promise<TeamWithMembers> {
  const [team] = await db
    .select({ id: teamsTable.id })
    .from(teamsTable)
    .where(eq(teamsTable.id, id));
  if (!team) throw new TeamError(404, "Team not found.");

  const nextName = patch.name?.trim();
  if (nextName !== undefined && nextName === "") {
    throw new TeamError(400, "Team name cannot be empty.");
  }

  const [row] = await db
    .update(teamsTable)
    .set({
      ...(nextName ? { name: nextName } : {}),
      ...(patch.active !== undefined ? { active: patch.active } : {}),
      ...(patch.orderIndex !== undefined
        ? { orderIndex: patch.orderIndex }
        : {}),
    })
    .where(eq(teamsTable.id, id))
    .returning();

  return toTeam(row, await membersOf(row.id));
}

/**
 * Delete a team. Members referencing it are left unassigned (team_id null)
 * first so no orphan FK remains — the FK has no ON DELETE cascade.
 */
export async function deleteTeam(id: number): Promise<void> {
  await db.transaction(async (tx) => {
    const [team] = await tx
      .select({ id: teamsTable.id })
      .from(teamsTable)
      .where(eq(teamsTable.id, id));
    if (!team) throw new TeamError(404, "Team not found.");
    await tx
      .update(usersTable)
      .set({ teamId: null })
      .where(eq(usersTable.teamId, id));
    await tx.delete(teamsTable).where(eq(teamsTable.id, id));
  });
}
