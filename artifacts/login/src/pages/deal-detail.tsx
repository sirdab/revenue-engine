import { useCallback, useRef, useState } from "react";
import { useParams, Link } from "wouter";
import {
  useGetDeal,
  useUpdateDeal,
  useListActivities,
  useListNotes,
  useGetDealHistory,
  useListPersons,
  useListOrganizations,
  useListStages,
  useListPipelines,
  useListUserOptions,
  getGetDealQueryKey,
  getGetDealHistoryQueryKey,
  getListActivitiesQueryKey,
  getListNotesQueryKey,
  getListPersonsQueryKey,
  getListOrganizationsQueryKey,
  getListStagesQueryKey,
  getListUserOptionsQueryKey,
} from "@workspace/api-client-react";
import type { DealUpdate } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { invalidateDealCollections } from "@/lib/deal-collections";
import { useToast } from "@/hooks/use-toast";
import { useRecordRecentlyViewed } from "@/hooks/use-user-preferences";
import { requiredFieldsBlock } from "@/lib/deal-fields-api";
import { ArrowLeft, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from "@/components/ui/empty";
import { DealHeader } from "@/components/deals/detail/deal-header";
import { DealPipelineProgress } from "@/components/deals/detail/deal-pipeline-progress";
import { DealActivityComposer } from "@/components/deals/detail/deal-activity-composer";
import { DealTimeline } from "@/components/deals/detail/deal-timeline";
import { DealSummaryCard } from "@/components/deals/detail/deal-summary-card";
import { DealFocusPanel } from "@/components/deals/detail/deal-focus-panel";
import { DealDetailsCard } from "@/components/deals/detail/deal-details-card";
import { DealCustomFieldsCard } from "@/components/deals/detail/deal-custom-fields-card";
import { RequiredFieldsDialog } from "@/components/deals/detail/required-fields-dialog";
import { DealRelatedEntities } from "@/components/deals/detail/deal-related-entities";
import { DealDocumentsCard } from "@/components/deals/detail/deal-documents-card";
import { Sheet, SheetContent, SheetTitle, SheetClose } from "@/components/ui/sheet";
import { useI18n } from "@/lib/i18n/i18n";

// How long before React Query considers data stale enough to refetch.
// Stages almost never change — 10 min. Deal / activities / notes — 30 s.
const STALE_STABLE = 10 * 60_000;
const STALE_LIVE = 30_000;

export default function DealDetailPage() {
  const { id } = useParams();
  const dealId = parseInt(id || "0", 10);

  return (
    <div className="h-full w-full overflow-y-auto px-3 py-3 lg:px-4">
      <DealDetailContent dealId={dealId} />
    </div>
  );
}

/**
 * Right-side drawer alternative to the full `/deal/:id` page, for the
 * `deals.openMode === "drawer"` preference (see `useDealOpenMode`). Renders
 * the exact same `DealDetailContent` as the page route — no duplicated
 * fetch/commit logic — inside the app's standard `Sheet` pattern.
 */
export function DealDetailDrawer({
  dealId,
  open,
  onOpenChange,
}: {
  dealId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // Title for the drawer header bar. Same query key `DealDetailContent`
  // uses, so React Query dedupes it — no extra network request.
  const { t } = useI18n();
  const { data: deal } = useGetDeal(dealId ?? 0, {
    query: {
      enabled: open && dealId != null,
      queryKey: getGetDealQueryKey(dealId ?? 0),
      staleTime: STALE_LIVE,
    },
  });

  return (
    <Sheet side="end" open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col p-0 sm:max-w-2xl lg:max-w-4xl">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b bg-background px-4 py-2.5">
          <SheetTitle className="truncate text-body font-semibold text-foreground">
            {deal?.title ?? t("dealDetail.title")}
          </SheetTitle>
          <SheetClose className="rounded-sm p-1 text-subtle opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
            <X className="h-4 w-4" />
            <span className="sr-only">{t("common.close")}</span>
          </SheetClose>
        </div>
        {dealId != null && (
          <div className="flex-1 overflow-y-auto px-3 py-3 lg:px-4">
            <DealDetailContent dealId={dealId} />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function DealDetailContent({ dealId }: { dealId: number }) {
  const { t } = useI18n();
  const { data: deal, isLoading: dealLoading } = useGetDeal(dealId, {
    query: {
      enabled: !!dealId,
      queryKey: getGetDealQueryKey(dealId),
      staleTime: STALE_LIVE,
    },
  });
  useRecordRecentlyViewed(
    deal ? { type: "deal", href: `/deal/${deal.id}`, title: deal.title } : null,
  );
  // includeDrafts only ever adds the caller's own drafts (enforced server-side)
  // — the deal timeline is the one surface where drafts appear.
  const { data: activities = [], isLoading: activitiesLoading } =
    useListActivities(
      { dealId, includeDrafts: true },
      {
        query: {
          enabled: !!dealId,
          queryKey: getListActivitiesQueryKey({ dealId, includeDrafts: true }),
          staleTime: STALE_LIVE,
        },
      },
    );
  const { data: notes = [], isLoading: notesLoading } = useListNotes(
    { dealId, includeDrafts: true },
    {
      query: {
        enabled: !!dealId,
        queryKey: getListNotesQueryKey({ dealId, includeDrafts: true }),
        staleTime: STALE_LIVE,
      },
    },
  );
  const { data: history, isLoading: historyLoading } = useGetDealHistory(
    dealId,
    {
      query: {
        enabled: !!dealId,
        queryKey: getGetDealHistoryQueryKey(dealId),
        staleTime: STALE_LIVE,
      },
    },
  );
  const { data: stages = [], isLoading: stagesLoading } = useListStages(
    undefined,
    { query: { queryKey: getListStagesQueryKey(), staleTime: STALE_STABLE } },
  );
  const { data: pipelines = [] } = useListPipelines();

  // Slim active-user directory for the owner picker. Fetched eagerly: the
  // activity composer and timeline already warm the same query key on mount.
  const { data: users = [] } = useListUserOptions({
    query: {
      queryKey: getListUserOptionsQueryKey(),
      staleTime: STALE_STABLE,
    },
  });
  const personName = deal?.personName ?? "";
  const organizationName = deal?.organizationName ?? "";
  const { data: personMatches = [] } = useListPersons(
    { q: personName },
    {
      query: {
        enabled: !!personName,
        queryKey: getListPersonsQueryKey({ q: personName }),
        staleTime: STALE_STABLE,
      },
    },
  );
  const { data: orgMatches = [] } = useListOrganizations(
    { q: organizationName },
    {
      query: {
        enabled: !!organizationName,
        queryKey: getListOrganizationsQueryKey({ q: organizationName }),
        staleTime: STALE_STABLE,
      },
    },
  );
  const updateDeal = useUpdateDeal();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  // A stage move (or marking as won) blocked on required fields: the modal
  // gates the retry.
  // The activity the composer just wrote, flashed in the timeline beside it.
  const [flashId, setFlashId] = useState<number | null>(null);
  const [requiredPrompt, setRequiredPrompt] = useState<{
    keys: string[];
    stageName: string | null;
    action: "move" | "won";
    patch: Partial<DealUpdate>;
  } | null>(null);

  // Race-protected commit: only invalidate once every in-flight edit settles.
  // Resolves true on success so callers (the required-fields retry) can tell.
  const inFlight = useRef(0);
  const commit = useCallback(
    async (patch: Partial<DealUpdate>): Promise<boolean> => {
      inFlight.current += 1;
      try {
        await updateDeal.mutateAsync({ id: dealId, data: patch });
        return true;
      } catch (e) {
        // The server refuses stage moves while the target stage's required
        // fields are empty — collect them in the modal instead of toasting.
        const block = requiredFieldsBlock(e);
        if (block) {
          setRequiredPrompt({ ...block, patch });
        } else {
          // The server's message says why.
          const reason = (e as { data?: { error?: unknown } } | null)?.data?.error;
          toast({
            title: t("dealDetail.updateFailed"),
            ...(typeof reason === "string" ? { description: reason } : {}),
            variant: "destructive",
          });
        }
        return false;
      } finally {
        inFlight.current -= 1;
        if (inFlight.current === 0) {
          // The pipeline/list/forecast views render this deal too — without
          // this they replay their cache on return. Passing the id
          // also covers this page's own deal + history queries.
          invalidateDealCollections(queryClient, [dealId]);
        }
      }
    },
    [dealId, updateDeal, queryClient, toast],
  );

  // Retry the blocked move once the modal's required fields are filled. A
  // repeat 409 (e.g. a field was cleared meanwhile) refreshes the modal.
  const confirmBlockedMove = useCallback(async () => {
    if (!requiredPrompt) return;
    const ok = await commit(requiredPrompt.patch);
    if (ok) setRequiredPrompt(null);
  }, [requiredPrompt, commit]);

  if (dealLoading) return <DealDetailSkeleton />;

  if (!deal) {
    return (
      <div className="mx-auto max-w-md p-8">
        <Empty className="border-dashed py-12">
          <EmptyHeader>
            <EmptyTitle>{t("dealDetail.notFound")}</EmptyTitle>
            <EmptyDescription>
              {t("dealDetail.notFoundBody")}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild variant="outline">
              <Link href="/deals">
                <ArrowLeft className="me-1.5 h-4 w-4" /> {t("dealDetail.backToDeals")}
              </Link>
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    );
  }

  const person = personMatches.find((p) => p.id === deal.personId);
  const organization = orgMatches.find((o) => o.id === deal.organizationId);
  const stage = stages.find((s) => s.id === deal.stageId);

  return (
    <>
      <div className="flex flex-col gap-3">
        {/* Combined header + chevron pipeline card */}
        <div className="overflow-hidden rounded-2xl bg-card shadow-card">
          <DealHeader
            deal={deal}
            onCommit={commit}
            isSaving={updateDeal.isPending}
          />
          <DealPipelineProgress
            deal={deal}
            pipelines={pipelines}
            stages={stages}
            stageDurations={history?.stageDurations ?? []}
            loading={stagesLoading}
            onStageChange={(stageId) => commit({ stageId })}
            onCommit={commit}
          />
        </div>

        {/* Two-column body — facts on the left, interaction on the right */}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[20rem_minmax(0,1fr)] xl:grid-cols-[24rem_minmax(0,1fr)] lg:items-start">
          {/* Left: deal facts */}
          <div className="flex w-full min-w-0 flex-col gap-3">
            <DealSummaryCard
              deal={deal}
              stage={stage}
              stages={stages}
              pipelines={pipelines}
              users={users}
              onCommit={commit}
            />
            <DealDetailsCard
              deal={deal}
              person={person}
              onCommit={commit}
            />
            <DealCustomFieldsCard dealId={dealId} pipelineId={deal.pipelineId} />
            <DealDocumentsCard
              dealId={dealId}
              archived={deal.archived || deal.status === "deleted"}
            />
            <DealRelatedEntities
              deal={deal}
              person={person}
              organization={organization}
            />
          </div>

          {/* Right: open tasks above the composer + timeline (R14). Page and
              drawer share this component, so one reorder covers both. */}
          <div className="flex min-w-0 flex-col gap-3">
            <DealFocusPanel
              dealId={dealId}
              activities={activities}
              loading={activitiesLoading}
            />
            <DealActivityComposer dealId={dealId} onLogged={setFlashId} />
            <DealTimeline
              dealId={dealId}
              activities={activities}
              notes={notes}
              changeEvents={history?.events ?? []}
              loading={activitiesLoading || notesLoading || historyLoading}
              flashActivityId={flashId}
            />
          </div>
        </div>
      </div>

      {requiredPrompt ? (
        <RequiredFieldsDialog
          dealId={dealId}
          requiredKeys={requiredPrompt.keys}
          stageName={requiredPrompt.stageName}
          open
          onOpenChange={(o) => !o && setRequiredPrompt(null)}
          onConfirm={confirmBlockedMove}
          confirming={updateDeal.isPending}
        />
      ) : null}
    </>
  );
}

function DealDetailSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-28 w-full rounded-xl" />
      <div className="flex flex-col gap-3 lg:flex-row">
        <div className="flex flex-1 flex-col gap-3">
          <Skeleton className="h-44 w-full rounded-xl" />
          <Skeleton className="h-72 w-full rounded-xl" />
        </div>
        <div className="flex w-full flex-col gap-3 lg:w-[320px]">
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-36 w-full rounded-xl" />
          <Skeleton className="h-48 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}
