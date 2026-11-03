import {
  Phone,
  Users,
  Mail,
  CheckSquare,
  Flag,
  MessageCircle,
  type LucideIcon,
} from "lucide-react";
import type { ActivityType } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { useI18n, type MessageKey, type Translate } from "@/lib/i18n/i18n";
import { DICTIONARIES, tStatic } from "@/lib/i18n/static";
import { LOCALES } from "@/lib/i18n/locales";

type ActivityTypeOption = {
  /** Message key of the type's name; also the default subject (see below). */
  label: MessageKey;
  Icon: LucideIcon;
  selected: string;
  iconColor: string;
};

// Keyed by ActivityType so the type checker forces every enum value to have a
// visual representation — a new activity type can never silently disappear.
export const ACTIVITY_TYPE_CONFIG: Record<ActivityType, ActivityTypeOption> = {
  call: {
    label: "dealActivity.type.call",
    Icon: Phone,
    selected: "border-sky-500 bg-sky-50 text-sky-700",
    iconColor: "text-sky-500",
  },
  meeting: {
    label: "dealActivity.type.meeting",
    Icon: Users,
    selected: "border-violet-500 bg-violet-50 text-violet-700",
    iconColor: "text-violet-500",
  },
  email: {
    label: "dealActivity.type.email",
    Icon: Mail,
    selected: "border-amber-500 bg-amber-50 text-amber-700",
    iconColor: "text-amber-500",
  },
  task: {
    label: "dealActivity.type.task",
    Icon: CheckSquare,
    selected: "border-teal-500 bg-teal-50 text-teal-700",
    iconColor: "text-teal-500",
  },
  deadline: {
    label: "dealActivity.type.deadline",
    Icon: Flag,
    selected: "border-rose-500 bg-rose-50 text-rose-700",
    iconColor: "text-rose-500",
  },
  whatsapp: {
    label: "dealActivity.type.whatsapp",
    Icon: MessageCircle,
    selected: "border-green-500 bg-green-50 text-green-700",
    iconColor: "text-green-500",
  },
};

/**
 * Types where someone reaches another person, so "did they reply?" has an
 * answer: only these offer Replied / No reply. Mirrors the
 * server's `DEAL_ACTIVITY_CONTACT_TYPES`; a task or deadline is always
 * planned work and keeps the plain create / mark-done flow.
 */
export const CONTACT_TYPES: readonly ActivityType[] = [
  "call",
  "meeting",
  "email",
  "whatsapp",
];

export function isContactType(type: ActivityType): boolean {
  return CONTACT_TYPES.includes(type);
}

// A sensible default subject per activity type ("Call", "Meeting", …) so an
// activity can be logged in one step. Editable by the user afterward.
export const defaultSubjectFor = (type: ActivityType) =>
  tStatic(ACTIVITY_TYPE_CONFIG[type].label);

// The set of type-label defaults, so a caller can tell an untouched default
// subject apart from something the user actually typed (and only overwrite the
// former when the type changes). Every language's word is in the set, so a
// default written in one language is still recognised after a switch.
export const DEFAULT_SUBJECTS = new Set(
  Object.values(ACTIVITY_TYPE_CONFIG).flatMap((c) =>
    LOCALES.map((locale) => DICTIONARIES[locale][c.label] ?? ""),
  ),
);


const DURATIONS: { value: string; label: MessageKey | null }[] = [
  { value: "", label: "activity.duration.none" },
  { value: "00:15", label: null },
  { value: "00:30", label: null },
  { value: "01:00", label: null },
  { value: "01:30", label: null },
  { value: "02:00", label: null },
];

/** "15m", "1.5h": the duration as a compact number of minutes or hours, in
 *  the active language's digits, with the unit from the dictionary. */
function durationLabel(t: Translate, value: string): string {
  const [h, m] = value.split(":").map(Number);
  const minutes = h * 60 + m;
  if (minutes < 60) return t("activity.duration.minutes", { count: minutes });
  const hours = minutes / 60;
  return t("activity.duration.hours", { count: Number.isInteger(hours) ? hours : hours.toFixed(1) });
}

export function DurationPicker({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <div
      role="radiogroup"
      aria-label={t("activity.composer.duration")}
      className={cn("flex flex-wrap gap-1.5", className)}
    >
      {DURATIONS.map(({ value: v, label: labelKey }) => {
        const label = labelKey ? t(labelKey) : durationLabel(t, v);
        const isActive = (value || "") === v;
        return (
          <button
            key={v || "none"}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => onChange(v)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              isActive
                ? "border-teal-500 bg-teal-50 text-teal-700"
                : "border-slate-200 text-slate-500 hover:border-slate-300 hover:bg-slate-50",
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
