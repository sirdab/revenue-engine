import type { ComponentType } from "react";
import {
  useCreateActivity,
  useDeleteActivity,
  useMarkActivityNoReply,
  useUpdateActivity,
  type Activity,
  type ActivityInput,
  type ActivityType,
  type ActivityUpdate,
} from "@workspace/api-client-react";
import type { MessageKey, Translate } from "@/lib/i18n/i18n";
import {
  ACTIVITY_TYPE_CONFIG,
  CONTACT_TYPES,
} from "@/components/activities/activity-fields";
import type { ActivityOutcome } from "./activity-rules";

// The seam between the shared activity dialogs and the activities API.
// A dialog takes a source and a view and never imports a
// generated hook itself; the caller decides which caches a write refreshes.

/** The shape every shared dialog reads. */
export interface ActivityView {
  id: number;
  subject: string;
  type: string;
  note: string | null;
  done: boolean;
  outcome: ActivityOutcome | null;
  dueDate: string | null;
  /** HH:MM */
  dueTime: string | null;
  /** HH:MM */
  duration: string | null;
  ownerId: number | null;
  ownerName?: string | null;
  /** ISO timestamps. */
  addTime?: string;
  markedAsDoneTime?: string | null;
  draft?: boolean;
  links?: {
    deal: { id: number; label: string | null } | null;
    person: { id: number; label: string | null } | null;
    /** The activity's organization, carried so a retry keeps it. */
    orgId?: number | null;
  };
}

/** Every field a shared dialog can change. */
export interface ActivityPatch {
  subject?: string;
  type?: string;
  note?: string | null;
  done?: boolean;
  dueDate?: string | null;
  dueTime?: string | null;
  duration?: string | null;
  ownerId?: number | null;
  dealId?: number | null;
  personId?: number | null;
}

/** What a new activity is written with. */
export interface ActivityCreate {
  subject: string;
  type: string;
  note?: string;
  outcome?: ActivityOutcome;
  /** "Plan for later" only: written already done (a task finished now). */
  done?: boolean;
  /** Saved unpublished, visible to its creator. */
  draft?: boolean;
  dueDate?: string;
  dueTime?: string;
  duration?: string;
  ownerId?: number;
  dealId?: number | null;
  personId?: number | null;
  orgId?: number | null;
}

/**
 * Where a new activity goes. Written from a deal page, the deal's links are
 * fixed and merged into every write (a pick in the form can't override
 * them).
 */
export interface CreateScope {
  deal?: { dealId?: number; personId?: number | null; orgId?: number | null };
}

export interface ActivityTypeOption {
  value: string;
  labelKey: MessageKey;
  icon: ComponentType<{ className?: string }>;
}

export interface ActivitySource {
  typeOptions: ActivityTypeOption[];
  contactTypes: readonly string[];
  /**
   * The types offered when writing an activity, most used first. Rows of
   * the other types (deadline) still display and can still be edited.
   */
  pickerTypes: readonly string[];
  create: (input: ActivityCreate, scope: CreateScope) => Promise<ActivityView>;
  remove: (view: ActivityView) => Promise<void>;
  typeLabel: (view: ActivityView, t: Translate) => string;
  typeIcon: (view: ActivityView) => ComponentType<{ className?: string }>;
  update: (id: number, patch: ActivityPatch) => Promise<ActivityView>;
  markNoReply: (id: number) => Promise<{ closed: ActivityView; followUp: ActivityView }>;
  pending: boolean;
}

const hhmm = (v: string | null | undefined) => (v ? v.slice(0, 5) : null);

/** The types offered when writing (see `pickerTypes`). */
export const DEAL_PICKER_TYPES: readonly string[] = ["call", "whatsapp", "meeting", "email", "task"];

export const DEAL_TYPE_OPTIONS: ActivityTypeOption[] = (
  Object.keys(ACTIVITY_TYPE_CONFIG) as ActivityType[]
).map((value) => ({
  value,
  labelKey: ACTIVITY_TYPE_CONFIG[value].label,
  icon: ACTIVITY_TYPE_CONFIG[value].Icon,
}));

const iconFallback = ACTIVITY_TYPE_CONFIG.task.Icon;

function optionLabel(options: ActivityTypeOption[], view: ActivityView, t: Translate) {
  const o = options.find((x) => x.value === view.type);
  // An unknown type is a server enum the client hasn't shipped yet; its raw
  // value beats nothing.
  return o ? t(o.labelKey) : view.type;
}

function optionIcon(options: ActivityTypeOption[], view: ActivityView) {
  return options.find((x) => x.value === view.type)?.icon ?? iconFallback;
}

export function dealToView(a: Activity): ActivityView {
  return {
    id: a.id,
    subject: a.subject,
    type: a.type,
    note: a.note ?? null,
    done: a.done,
    outcome: a.outcome ?? null,
    dueDate: a.dueDate ?? null,
    dueTime: hhmm(a.dueTime),
    duration: hhmm(a.duration),
    ownerId: a.ownerId ?? null,
    ownerName: a.ownerName ?? null,
    addTime: a.addTime,
    markedAsDoneTime: a.markedAsDoneTime ?? null,
    draft: a.draft ?? false,
    links: {
      deal: a.dealId != null ? { id: a.dealId, label: a.dealTitle ?? null } : null,
      person: a.personId != null ? { id: a.personId, label: a.personName ?? null } : null,
      orgId: a.orgId ?? null,
    },
  };
}

/** The shared patch as a deal PATCH body. Exported for tests. */
export function toDealUpdate(p: ActivityPatch): ActivityUpdate {
  const body: ActivityUpdate = {};
  if (p.subject !== undefined) body.subject = p.subject;
  if (p.type !== undefined) body.type = p.type as ActivityType;
  if (p.note !== undefined) body.note = p.note;
  if (p.done !== undefined) body.done = p.done;
  if (p.dueDate !== undefined) body.dueDate = p.dueDate;
  if (p.dueTime !== undefined) body.dueTime = p.dueTime;
  if (p.duration !== undefined) body.duration = p.duration;
  if (p.ownerId !== undefined) body.ownerId = p.ownerId;
  if (p.dealId !== undefined) body.dealId = p.dealId;
  if (p.personId !== undefined) body.personId = p.personId;
  return body;
}

/** A new activity as a deal create body. Exported for tests. */
export function toDealCreate(i: ActivityCreate): ActivityInput {
  const outcome = i.outcome;
  return {
    subject: i.subject,
    type: i.type as ActivityType,
    ...(i.note ? { note: i.note } : {}),
    ...(outcome ? { outcome } : {}),
    ...(i.done ? { done: true } : {}),
    ...(i.draft ? { draft: true } : {}),
    ...(i.dueDate ? { dueDate: i.dueDate } : {}),
    ...(i.dueTime ? { dueTime: i.dueTime } : {}),
    ...(i.duration ? { duration: i.duration } : {}),
    ...(i.ownerId ? { ownerId: i.ownerId } : {}),
    ...(i.dealId ? { dealId: i.dealId } : {}),
    ...(i.personId ? { personId: i.personId } : {}),
    ...(i.orgId ? { orgId: i.orgId } : {}),
  };
}

/**
 * Deal activities. Each deal surface caches different queries (a deal's
 * timeline, the Activities page, the home widget), so the caller says what
 * to refresh; `onAfter` gets every id a write touched — both the closed
 * attempt and its copy on No reply, so both histories refresh.
 */
export function useDealActivitySource(onAfter: (ids: number[]) => void): ActivitySource {
  const create = useCreateActivity();
  const update = useUpdateActivity();
  const del = useDeleteActivity();
  const noReply = useMarkActivityNoReply();
  return {
    typeOptions: DEAL_TYPE_OPTIONS,
    contactTypes: CONTACT_TYPES,
    pickerTypes: DEAL_PICKER_TYPES,
    typeLabel: (v, t) => optionLabel(DEAL_TYPE_OPTIONS, v, t),
    typeIcon: (v) => optionIcon(DEAL_TYPE_OPTIONS, v),
    remove: async (v) => {
      await del.mutateAsync({ id: v.id });
      onAfter([v.id]);
    },
    create: async (input, scope) => {
      const row = await create.mutateAsync({
        data: toDealCreate({
          ...input,
          ...(scope.deal?.dealId ? { dealId: scope.deal.dealId } : {}),
          ...(scope.deal?.personId ? { personId: scope.deal.personId } : {}),
          ...(scope.deal?.orgId ? { orgId: scope.deal.orgId } : {}),
        }),
      });
      onAfter([row.id]);
      return dealToView(row);
    },
    update: async (id, patch) => {
      const row = await update.mutateAsync({ id, data: toDealUpdate(patch) });
      onAfter([row.id]);
      return dealToView(row);
    },
    markNoReply: async (id) => {
      const { closed, followUp } = await noReply.mutateAsync({ id });
      onAfter([closed.id, followUp.id]);
      return { closed: dealToView(closed), followUp: dealToView(followUp) };
    },
    pending: create.isPending || update.isPending || del.isPending || noReply.isPending,
  };
}
