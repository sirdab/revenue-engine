import { useCallback, useEffect, useMemo } from "react";
import { useParams, Link } from "wouter";
import {
  useGetPerson,
  useUpdatePerson,
  useListDeals,
  useListActivities,
  useGetPersonHistory,
  getGetPersonQueryKey,
  getListDealsQueryKey,
  getListActivitiesQueryKey,
  getGetPersonHistoryQueryKey,
} from "@workspace/api-client-react";
import type { PersonUpdate } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useRecordRecentlyViewed } from "@/hooks/use-user-preferences";
import { ArrowLeft, Briefcase, Mail, Phone, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@sirdab/one/components/empty-state";
import {
  DealSectionCard,
  DealField,
} from "@/components/deals/detail/deal-section-card";
import { EditableText } from "@/components/deals/inline-edit";
import { LabelsEditor } from "@/components/shared/labels-editor";
import { formatDate } from "@/lib/format";
import { PersonHeader } from "@/components/persons/detail/person-header";
import { PersonDeals } from "@/components/persons/detail/person-deals";
import { PersonActivities } from "@/components/persons/detail/person-activities";
import { PersonHistory } from "@/components/persons/detail/person-history";
import { useI18n } from "@/lib/i18n/i18n";
import { invalidatePersonCaches } from "@/lib/contact-cache";

const STALE = 30_000;

export default function PersonDetailPage() {
  const { t } = useI18n();
  const { id } = useParams();
  const personId = parseInt(id || "0", 10);

  const { data: person, isLoading: personLoading } = useGetPerson(personId, {
    query: {
      enabled: !!personId,
      queryKey: getGetPersonQueryKey(personId),
      staleTime: STALE,
    },
  });

  useRecordRecentlyViewed(
    person
      ? { type: "person", href: `/person/${personId}`, title: person.name }
      : null,
  );
  // The deals list defaults to open-only; `status: "all"` lifts that so the
  // person shows their full deal history (open + won/lost) in one query.
  const dealParams = { personId, status: "all", limit: 200 } as const;
  const { data: allDeals, isLoading: dealsLoading } = useListDeals(dealParams, {
    query: {
      enabled: !!personId,
      queryKey: getListDealsQueryKey(dealParams),
      staleTime: STALE,
    },
  });
  const { data: activities = [], isLoading: activitiesLoading } =
    useListActivities(
      { personId },
      {
        query: {
          enabled: !!personId,
          queryKey: getListActivitiesQueryKey({ personId }),
          staleTime: STALE,
        },
      },
    );
  const { data: history, isLoading: historyLoading } = useGetPersonHistory(
    personId,
    {
      query: {
        enabled: !!personId,
        queryKey: getGetPersonHistoryQueryKey(personId),
        staleTime: STALE,
      },
    },
  );

  const updatePerson = useUpdatePerson();
  const queryClient = useQueryClient();
  const { toast } = useToast();

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

  const commit = useCallback(
    async (patch: Partial<PersonUpdate>) => {
      try {
        await updatePerson.mutateAsync({ id: personId, data: patch });
        invalidatePersonCaches(queryClient, personId, { renamed: "name" in patch });
        queryClient.invalidateQueries({
          queryKey: getGetPersonHistoryQueryKey(personId),
        });
      } catch {
        toast({ title: t("dealDetail.updateFailed"), variant: "destructive" });
      }
    },
    [personId, updatePerson, queryClient, toast],
  );

  if (personLoading) return <PersonDetailSkeleton />;

  if (!person) {
    return (
      <div className="mx-auto max-w-md p-8">
        <EmptyState
          className="py-12"
          size="lg"
          icon={SearchX}
          title={t("contacts.personNotFound")}
          caption={t("contacts.personNotFoundBody")}
          action={
            <Button asChild variant="outline">
              <Link href="/contacts">
                <ArrowLeft className="me-1.5 h-4 w-4" /> {t("contacts.backToContacts")}
              </Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto h-full w-full max-w-7xl overflow-y-auto px-3 py-3 lg:px-4">
      <div className="flex flex-col gap-3">
        <div className="overflow-hidden rounded-xl bg-card shadow-card">
          <PersonHeader person={person} onCommit={commit} />
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[20rem_minmax(0,1fr)] lg:items-start">
          {/* Left: person facts */}
          <div className="flex w-full min-w-0 flex-col gap-3">
            <DealSectionCard title={t("common.details")}>
              <div className="space-y-4">
                <div>
                  <div className="mb-1 text-caption text-muted-foreground">
                    <Briefcase className="me-1 inline h-3 w-3" /> {t("common.jobTitle")}
                  </div>
                  <EditableText
                    value={person.jobTitle ?? ""}
                    onCommit={(jobTitle) => commit({ jobTitle: jobTitle.trim() || null })}
                    placeholder={t("contacts.addJobTitle")}
                    allowClear
                  />
                </div>
                <div>
                  <div className="mb-1 text-caption text-muted-foreground">
                    <Mail className="me-1 inline h-3 w-3" /> {t("common.email")}
                  </div>
                  <EditableText
                    value={person.email ?? ""}
                    // Clearing commits "", which the API would store as-is.
                    onCommit={(email) => commit({ email: email || null })}
                    placeholder={t("contacts.addEmail")}
                    allowClear
                  />
                </div>
                <div>
                  <div className="mb-1 text-caption text-muted-foreground">
                    <Phone className="me-1 inline h-3 w-3" /> {t("common.phone")}
                  </div>
                  <EditableText
                    value={person.phone ?? ""}
                    onCommit={(phone) => commit({ phone: phone || null })}
                    placeholder={t("contacts.addPhone")}
                    allowClear
                  />
                </div>
                <div>
                  <div className="mb-1 text-caption text-muted-foreground">
                    {t("deals.field.labels")}
                  </div>
                  <LabelsEditor
                    entity="person"
                    labels={person.labels ?? []}
                    onChange={(labels) => commit({ labels })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-4 border-t border-border pt-4">
                  <DealField label={t("common.owner")} value={person.ownerName} />
                  <DealField label={t("common.added")} value={formatDate(person.addTime)} />
                </div>
              </div>
            </DealSectionCard>
          </div>

          {/* Right: deals + activities + history */}
          <div className="flex min-w-0 flex-col gap-3">
            <PersonDeals deals={deals} loading={dealsLoading} />
            <PersonActivities
              activities={activities}
              loading={activitiesLoading}
            />
            <PersonHistory
              events={history?.events ?? []}
              loading={historyLoading}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function PersonDetailSkeleton() {
  return (
    <div className="mx-auto h-full w-full max-w-7xl overflow-y-auto px-3 py-3 lg:px-4">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-20 w-full rounded-xl" />
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[20rem_minmax(0,1fr)]">
          <div className="flex flex-col gap-3">
            <Skeleton className="h-40 w-full rounded-xl" />
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
