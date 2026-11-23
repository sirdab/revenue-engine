import type { ReactNode } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronRight, Loader2, X } from "lucide-react";
import {
  getGetOnboardingQueryKey,
  useDismissOnboarding,
  useGetOnboarding,
  useLoadSampleData,
  useRemoveSampleData,
  type OnboardingStatus,
  type OnboardingStepKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/api-error";
import { useI18n, type MessageKey } from "@/lib/i18n/i18n";
import { cn } from "@/lib/utils";

// The getting-started checklist at the top of Home, for admins of a new
// workspace. Each step ticks itself off from the workspace's own data
// (api-server/src/lib/onboarding.ts). It disappears once every step is done,
// or when the admin closes it; sample data can be removed either way.

const STEPS: Record<OnboardingStepKey, { title: MessageKey; body: MessageKey; href?: string }> = {
  region: { title: "onboarding.region.title", body: "onboarding.region.body", href: "/admin/settings/workspace" },
  contacts: { title: "onboarding.contacts.title", body: "onboarding.contacts.body", href: "/import" },
  team: { title: "onboarding.team.title", body: "onboarding.team.body", href: "/admin/users" },
  deal: { title: "onboarding.deal.title", body: "onboarding.deal.body" },
};

export function GettingStarted({ onCreateDeal }: { onCreateDeal: () => void }) {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data } = useGetOnboarding();
  const dismiss = useDismissOnboarding();
  const load = useLoadSampleData();
  const remove = useRemoveSampleData();

  if (!data) return null;
  const done = data.steps.filter((s) => s.done).length;
  const allDone = done === data.steps.length;

  // Everything the sample touches: deals, contacts, activities, the board.
  const refreshAll = (next: OnboardingStatus) => {
    queryClient.setQueryData(getGetOnboardingQueryKey(), next);
    void queryClient.invalidateQueries({
      predicate: (q) => q.queryKey[0] !== getGetOnboardingQueryKey()[0],
    });
  };
  const run = async (fn: () => Promise<OnboardingStatus>, okKey: MessageKey) => {
    try {
      refreshAll(await fn());
      toast({ title: t(okKey) });
    } catch (err) {
      toast({ title: t("onboarding.failed"), description: errorMessage(err), variant: "destructive" });
    }
  };
  const busy = load.isPending || remove.isPending;
  const removeButton = (
    <Button
      variant="ghost"
      size="sm"
      disabled={busy}
      onClick={() => void run(() => remove.mutateAsync(), "onboarding.sample.removed")}
    >
      {remove.isPending && <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />}
      {t("onboarding.sample.remove")}
    </Button>
  );

  // Closed or finished: only a reminder that sample records are still there.
  if (data.dismissed || allDone) {
    if (!data.sampleData) return null;
    return (
      <Card className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 max-sm:px-4">
        <p className="text-body-quiet text-muted-foreground">{t("onboarding.sample.loadedNote")}</p>
        {removeButton}
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex items-start justify-between gap-3 px-5 pt-4 max-sm:px-4">
        <div className="min-w-0 space-y-1">
          <h2 className="text-label text-foreground">{t("onboarding.title")}</h2>
          <p className="text-body-quiet text-muted-foreground">{t("onboarding.subtitle")}</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="-me-2 -mt-1 shrink-0"
          aria-label={t("onboarding.dismiss")}
          disabled={dismiss.isPending}
          onClick={() =>
            void dismiss
              .mutateAsync({ data: { dismissed: true } })
              .then((next) => queryClient.setQueryData(getGetOnboardingQueryKey(), next))
              .catch((err) =>
                toast({ title: t("onboarding.failed"), description: errorMessage(err), variant: "destructive" }),
              )
          }
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex items-center gap-3 px-5 pt-3 max-sm:px-4">
        <Progress value={(done / data.steps.length) * 100} className="h-1.5 flex-1" />
        <span className="shrink-0 text-caption text-muted-foreground tabular-nums">
          {t("onboarding.progress", { done, total: data.steps.length })}
        </span>
      </div>

      <ol className="mt-3 grid gap-px border-t border-border bg-border sm:grid-cols-2">
        {data.steps.map((step) => {
          const meta = STEPS[step.key];
          const inner: ReactNode = (
            <>
              <span
                className={cn(
                  "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                  step.done ? "border-transparent bg-success-subtle text-success-glyph" : "border-input",
                )}
                aria-hidden
              >
                {step.done && <Check className="h-3 w-3" />}
              </span>
              <span className="min-w-0 flex-1 space-y-0.5">
                <span className={cn("block text-body", step.done ? "text-muted-foreground line-through" : "text-foreground")}>
                  {t(meta.title)}
                </span>
                <span className="block text-caption-quiet text-subtle">{t(meta.body)}</span>
              </span>
              {!step.done && <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-subtle" aria-hidden />}
            </>
          );
          const cls =
            "flex w-full items-start gap-3 bg-card px-5 py-3 text-start transition-colors hover:bg-gray-alpha-50 max-sm:px-4";
          return (
            <li key={step.key} className="bg-card">
              <span className="sr-only">{step.done ? t("onboarding.stepDone") : t("onboarding.stepTodo")}</span>
              {meta.href ? (
                <Link href={meta.href} className={cls}>
                  {inner}
                </Link>
              ) : (
                <button type="button" className={cls} onClick={onCreateDeal}>
                  {inner}
                </button>
              )}
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-surface-whisper px-5 py-3 max-sm:px-4">
        <p className="text-body-quiet text-muted-foreground">
          {data.sampleData ? t("onboarding.sample.loadedNote") : t("onboarding.sample.prompt")}
        </p>
        {data.sampleData ? (
          removeButton
        ) : (
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() =>
              void run(() => load.mutateAsync({ data: { locale } }), "onboarding.sample.loaded")
            }
          >
            {load.isPending && <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />}
            {t("onboarding.sample.load")}
          </Button>
        )}
      </div>
    </Card>
  );
}
