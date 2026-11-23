import { useState } from "react";
import { Clock, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/lib/i18n/i18n";
import { cn } from "@/lib/utils";

// The hosted plan's trial reminder, for admins only. It appears in the last
// REMIND_DAYS of the trial (closable for the day) and stays once the trial has
// ended. A reminder only: nothing is locked. Absent on deployments without a
// trial (workspace.trial is null), which is every self-hosted install.

const REMIND_DAYS = 14;
const DAY_MS = 86_400_000;

function dismissKey(tenantId: number) {
  return `crm.trialBanner.${tenantId}`;
}
function today() {
  return new Date().toISOString().slice(0, 10);
}

export function TrialBanner() {
  const { user } = useAuth();
  const { t, tPlural, formatDate } = useI18n();
  const tenantId = user?.workspace?.id;
  const [dismissedToday, setDismissedToday] = useState(() => {
    if (tenantId == null) return false;
    try {
      return localStorage.getItem(dismissKey(tenantId)) === today();
    } catch {
      return false;
    }
  });

  const trial = user?.workspace?.trial;
  if (!user?.isAdmin || !trial || tenantId == null) return null;
  const endsAt = new Date(trial.endsAt);
  const daysLeft = Math.ceil((endsAt.getTime() - Date.now()) / DAY_MS);
  const ended = daysLeft <= 0;
  if (daysLeft > REMIND_DAYS || (!ended && dismissedToday)) return null;

  const close = () => {
    try {
      localStorage.setItem(dismissKey(tenantId), today());
    } catch {
      // Blocked storage: it just reappears on the next load.
    }
    setDismissedToday(true);
  };
  const subject = encodeURIComponent(t("trial.mailSubject", { workspace: user.workspace?.name ?? "" }));

  return (
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-2 sm:px-6",
        ended ? "border-warning bg-warning-subtle" : "border-border bg-brand-subtle",
      )}
    >
      <Clock className={cn("h-4 w-4 shrink-0", ended ? "text-warning-glyph" : "text-brand")} aria-hidden />
      <p className="min-w-0 flex-1 text-body text-foreground">
        {ended
          ? t("trial.ended", { date: formatDate(endsAt, { day: "numeric", month: "long", year: "numeric" }) })
          : tPlural("trial.endsIn", daysLeft)}{" "}
        <span className="text-muted-foreground">{t("trial.price")}</span>
      </p>
      {trial.contactEmail && (
        <Button asChild size="sm" variant={ended ? "default" : "secondary"}>
          <a href={`mailto:${trial.contactEmail}?subject=${subject}`}>{t("trial.subscribe")}</a>
        </Button>
      )}
      {!ended && (
        <Button variant="ghost" size="icon" className="-me-2 h-7 w-7" aria-label={t("trial.dismiss")} onClick={close}>
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
