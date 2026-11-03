import { Users, Mail, Phone } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { initials } from "@/lib/format";
import { DealSectionCard } from "@/components/deals/detail/deal-section-card";
import type { Person } from "@workspace/api-client-react";
import { useI18n } from "@/lib/i18n/i18n";

export function OrganizationPeopleCard({
  people,
  loading,
}: {
  people: Person[];
  loading?: boolean;
}) {
  const { t } = useI18n();
  return (
    <DealSectionCard
      title={t("deals.related.people")}
      action={
        people.length > 0 ? (
          <span className="text-[11px] font-medium text-subtle">
            {people.length}
          </span>
        ) : undefined
      }
    >
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full rounded-lg" />
          ))}
        </div>
      ) : people.length === 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-border py-6 text-center text-sm text-subtle">
          <Users className="mx-auto h-4 w-4" />
          <span>{t("contacts.noPeopleLinked")}</span>
        </div>
      ) : (
        <ul className="space-y-1">
          {people.map((p) => (
            <li
              key={p.id}
              className="flex items-start gap-2.5 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-gray-alpha-50"
            >
              <Avatar className="mt-0.5 h-7 w-7 shrink-0">
                <AvatarFallback className="bg-muted text-[10px] font-semibold text-muted-foreground">
                  {initials(p.name)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-foreground">
                  {p.name}
                </div>
                {p.jobTitle && (
                  <div dir="auto" className="truncate text-xs text-muted-foreground">
                    {p.jobTitle}
                  </div>
                )}
                <div className="mt-0.5 flex flex-col gap-0.5">
                  {p.email && (
                    <a
                      href={`mailto:${p.email}`}
                      title={p.email}
                      className="flex min-w-0 items-center gap-1.5 text-xs text-brand hover:underline"
                    >
                      <Mail className="h-3 w-3 shrink-0" />
                      <span className="truncate">{p.email}</span>
                    </a>
                  )}
                  {p.phone && (
                    <a
                      href={`tel:${p.phone}`}
                      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-brand"
                    >
                      <Phone className="h-3 w-3 shrink-0" />
                      <span className="truncate">{p.phone}</span>
                    </a>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </DealSectionCard>
  );
}
