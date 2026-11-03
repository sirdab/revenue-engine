import { Circle, CheckCircle2, PhoneMissed } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/i18n";

// The circle→check button for marking an activity done. Shared between the
// deal timeline rows and the Open-tasks focus panel so the affordance stays
// identical in both places. The confirm/toggle flow itself lives in
// useMarkActivityDone — this is only the visual control.
export function MarkDoneToggle({
  done,
  noReply = false,
  onToggle,
  className,
}: {
  done: boolean;
  /** Closed as "no reply", or a demo call that didn't happen
   *  (no-show, rescheduled, missed by us): grey missed-call mark, not a
   *  check, so a failed attempt doesn't read as a completed one. */
  noReply?: boolean;
  onToggle: () => void;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={done ? t("activity.toggle.markNotDone") : t("activity.toggle.markDone")}
      className={cn(
        "shrink-0 text-slate-300 transition-colors hover:text-teal-600",
        className,
      )}
    >
      {done && noReply ? (
        <PhoneMissed className="h-4 w-4 text-slate-400" />
      ) : done ? (
        <CheckCircle2 className="h-4 w-4 text-teal-600" />
      ) : (
        <Circle className="h-4 w-4" />
      )}
    </button>
  );
}
