// Who may change a deal's owner. Pure, so the rule is tested on its own and
// the route only has to gather the inputs.
//
// A pipeline flagged `admin_only_reassign` (the inbound sales pipelines, head
// of commercial's call) locks reassignment to admins. Every pipeline the
// change touches counts: the one the deal sits in AND the one it is being
// moved to, so a rep can neither hand a locked deal to someone else on the
// way out nor bring a deal in under a new owner. Moving a deal between
// pipelines without changing its owner is never refused here.
//
// Only a person reassigning goes through this. Assignment rules, the
// first-activity claim (deal-claim.ts) and webhooks set owners on their own
// paths and keep running in every pipeline.

export const OWNER_CHANGE_ADMIN_ONLY =
  "Only an admin can reassign deals in this pipeline.";

export function ownerChangeAllowed(input: {
  isAdmin: boolean;
  ownerChanged: boolean;
  /** `admin_only_reassign` of each pipeline the change touches. */
  lockedPipelines: readonly boolean[];
}): boolean {
  if (input.isAdmin || !input.ownerChanged) return true;
  return !input.lockedPipelines.some(Boolean);
}
