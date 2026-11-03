import { useCallback, useMemo } from "react";
import { useParams, Link } from "wouter";
import {
  useGetOrganization,
  useUpdateOrganization,
  useListDeals,
  useListActivities,
  useGetOrganizationHistory,
  getGetOrganizationQueryKey,
  getListDealsQueryKey,
  getListActivitiesQueryKey,
  getGetOrganizationHistoryQueryKey,
} from "@workspace/api-client-react";
import type { OrganizationUpdate } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useRecordRecentlyViewed } from "@/hooks/use-user-preferences";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from "@/components/ui/empty";
import {
  DealSectionCard,
  DealField,
} from "@/components/deals/detail/deal-section-card";
import { EditableTextarea } from "@/components/deals/inline-edit";
import { LabelsEditor } from "@/components/shared/labels-editor";
import { formatDate } from "@/lib/format";
import { useOrganizationPeople } from "@/lib/organization-people";
import { OrganizationHeader } from "@/components/organizations/detail/organization-header";
import { OrganizationDeals } from "@/components/organizations/detail/organization-deals";
import { OrganizationPeopleCard } from "@/components/organizations/detail/organization-people-card";
import { OrganizationActivities } from "@/components/organizations/detail/organization-activities";
import { OrganizationHistory } from "@/components/organizations/detail/organization-history";
import { useI18n } from "@/lib/i18n/i18n";
import { invalidateOrganizationCaches } from "@/lib/contact-cache";

const STALE = 30_000;

export default function OrganizationDetailPage() {
  const { t } = useI18n();
  const { id } = useParams();
  const orgId = parseInt(id || "0", 10);

  const { data: organization, isLoading: orgLoading } = useGetOrganization(
    orgId,
    {
      query: {
        enabled: !!orgId,
        queryKey: getGetOrganizationQueryKey(orgId),
        staleTime: STALE,
      },
    },
  );
  useRecordRecentlyViewed(
    organization
      ? {
          type: "organization",
          href: `/organization/${organization.id}`,
          title: organization.name,
        }
      : null,
  );
  // The deals list defaults to open-only; `status: "all"` lifts that so the org
  // shows its full deal history (open + won/lost) in one query.
  const dealParams = {
    organizationId: orgId,
    status: "all",
    limit: 200,
  } as const;
  const { data: allDeals, isLoading: dealsLoading } = useListDeals(dealParams, {
    query: {
      enabled: !!orgId,
      queryKey: getListDealsQueryKey(dealParams),
      staleTime: STALE,
    },
  });
  const { data: activities = [], isLoading: activitiesLoading } =
    useListActivities(
      { orgId },
      {
        query: {
          enabled: !!orgId,
          queryKey: getListActivitiesQueryKey({ orgId }),
          staleTime: STALE,
        },
      },
    );
  const { data: people = [], isLoading: peopleLoading } =
    useOrganizationPeople(orgId);
  const { data: history, isLoading: historyLoading } = useGetOrganizationHistory(
    orgId,
    {
      query: {
        enabled: !!orgId,
        queryKey: getGetOrganizationHistoryQueryKey(orgId),
        staleTime: STALE,
      },
    },
  );

  // Open deals first, then closed (won/lost); deleted deals are hidden. The
  // ordering used to fall out of concatenating two queries — with one query it
  // has to be explicit, so a stable partition replaces the concat.
  const deals = useMemo(() => {
    const items = (allDeals?.items ?? []).filter((d) => d.status !== "deleted");
    return [
      ...items.filter((d) => d.status === "open"),
      ...items.filter((d) => d.status !== "open"),
    ];
  }, [allDeals]);

  const updateOrganization = useUpdateOrganization();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const commit = useCallback(
    async (patch: Partial<OrganizationUpdate>) => {
      try {
        await updateOrganization.mutateAsync({ id: orgId, data: patch });
        invalidateOrganizationCaches(queryClient, orgId, { renamed: "name" in patch });
        queryClient.invalidateQueries({
          queryKey: getGetOrganizationHistoryQueryKey(orgId),
        });
      } catch {
        toast({ title: t("dealDetail.updateFailed"), variant: "destructive" });
      }
    },
    [orgId, updateOrganization, queryClient, toast],
  );

  if (orgLoading) return <OrganizationDetailSkeleton />;

  if (!organization) {
    return (
      <div className="mx-auto max-w-md p-8">
        <Empty className="border-dashed py-12">
          <EmptyHeader>
            <EmptyTitle>{t("contacts.orgNotFound")}</EmptyTitle>
            <EmptyDescription>
              {t("contacts.orgNotFoundBody")}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild variant="outline">
              <Link href="/contacts">
                <ArrowLeft className="me-1.5 h-4 w-4" /> {t("contacts.backToContacts")}
              </Link>
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    );
  }

  return (
    <div className="mx-auto h-full w-full max-w-7xl overflow-y-auto px-3 py-3 lg:px-4">
      <div className="flex flex-col gap-3">
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <OrganizationHeader organization={organization} onCommit={commit} />
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[20rem_minmax(0,1fr)] lg:items-start">
          {/* Left: organization facts + people */}
          <div className="flex w-full min-w-0 flex-col gap-3">
            <DealSectionCard title={t("common.details")}>
              <div className="space-y-4">
                <div>
                  <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-subtle">
                    {t("common.address")}
                  </div>
                  <EditableTextarea
                    value={organization.address}
                    onCommit={(address) => commit({ address })}
                    placeholder={t("contacts.addAddress")}
                    rows={2}
                  />
                </div>
                <div>
                  <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-subtle">
                    {t("deals.field.labels")}
                  </div>
                  <LabelsEditor
                    entity="organization"
                    labels={organization.labels ?? []}
                    onChange={(labels) => commit({ labels })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-4 border-t border-border pt-4">
                  <DealField label={t("common.owner")} value={organization.ownerName} />
                  <DealField
                    label={t("common.added")}
                    value={formatDate(organization.addTime)}
                  />
                </div>
              </div>
            </DealSectionCard>
            <OrganizationPeopleCard people={people} loading={peopleLoading} />
          </div>

          {/* Right: deals + activities */}
          <div className="flex min-w-0 flex-col gap-3">
            <OrganizationDeals deals={deals} loading={dealsLoading} />
            <OrganizationActivities
              activities={activities}
              loading={activitiesLoading}
            />
            <OrganizationHistory
              events={history?.events ?? []}
              loading={historyLoading}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function OrganizationDetailSkeleton() {
  return (
    <div className="mx-auto h-full w-full max-w-7xl overflow-y-auto px-3 py-3 lg:px-4">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-20 w-full rounded-xl" />
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[20rem_minmax(0,1fr)]">
          <div className="flex flex-col gap-3">
            <Skeleton className="h-40 w-full rounded-xl" />
            <Skeleton className="h-48 w-full rounded-xl" />
          </div>
          <div className="flex flex-col gap-3">
            <Skeleton className="h-44 w-full rounded-xl" />
            <Skeleton className="h-40 w-full rounded-xl" />
            <Skeleton className="h-64 w-full rounded-xl" />
          </div>
        </div>
      </div>
    </div>
  );
}
