import type { ActivityCreate, ActivityView } from "./activity-source";
import type { ActivityMode } from "../log-plan";
import type { ActivityOutcome } from "./activity-rules";

// The shared composer's decisions, as pure functions so they can
// be tested without rendering anything. Type imports only: no React, no
// generated hooks.

export interface TypeLists {
  /** Every type the source has, in its display order. */
  all: readonly string[];
  /** Types someone reaches a person with: "did they reply?" applies. */
  contact: readonly string[];
}

/** Logging offers what can have happened; planning, what can be owed. */
export function typesFor(mode: ActivityMode, l: TypeLists): string[] {
  return mode === "log" ? l.all.filter((t) => l.contact.includes(t)) : [...l.all];
}

/** Where each mode starts: logging a call (or the caller's preference),
 *  planning a task. */
export function defaultType(mode: ActivityMode, l: TypeLists, prefer?: string): string {
  const offered = typesFor(mode, l);
  if (prefer && offered.includes(prefer)) return prefer;
  const start = mode === "log" ? "call" : "task";
  return offered.includes(start) ? start : (offered[0] ?? start);
}

/** Switching mode keeps the type when the new mode offers it (a call can be
 *  logged or planned); otherwise it starts where that mode starts. */
export function typeAfterSwitch(type: string, next: ActivityMode, l: TypeLists): string {
  return typesFor(next, l).includes(type) ? type : defaultType(next, l);
}

/** What stops a log from going, or null when it can. */
export function missingForLog(p: {
  contact: boolean;
  reply: ActivityOutcome | null;
  noteEmpty: boolean;
  /** Someone typed their own subject (not left blank or the type's name).
   *  Only the composer has a subject to type; completing planned work doesn't. */
  subjectTyped?: boolean;
}): "reply" | "response" | null {
  if (p.contact && !p.reply) return "reply";
  // Replied needs what they said, and a typed subject can say it ("Will
  // sign Monday"); anything else needs its text.
  if (p.contact && p.reply === "successful") {
    return p.noteEmpty && !p.subjectTyped ? "response" : null;
  }
  if (!p.contact && p.noteEmpty) return "response";
  return null;
}

/** The planned retry offered after a no reply: the same job — type,
 *  subject, owner and what it was linked to — due on the chosen day. */
export function retryInput(
  v: Pick<ActivityView, "subject" | "type" | "ownerId" | "links">,
  dueDate: string,
): ActivityCreate {
  return {
    subject: v.subject,
    type: v.type,
    dueDate,
    ...(v.ownerId ? { ownerId: v.ownerId } : {}),
    ...(v.links?.deal ? { dealId: v.links.deal.id } : {}),
    ...(v.links?.person ? { personId: v.links.person.id } : {}),
    ...(v.links?.orgId ? { orgId: v.links.orgId } : {}),
  };
}
