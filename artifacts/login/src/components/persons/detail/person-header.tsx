import { Link } from "wouter";
import { ArrowLeft, UserRound, Handshake } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { initials } from "@/lib/format";
import { EditableText } from "@/components/deals/inline-edit";
import type { Person, PersonUpdate } from "@workspace/api-client-react";
import { useI18n } from "@/lib/i18n/i18n";

function Metric({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-whisper px-2.5 py-1 text-xs text-muted-foreground">
      <span className="text-subtle">{icon}</span>
      <span className="font-semibold text-foreground">{value}</span>
      {label}
    </span>
  );
}

export function PersonHeader({
  person,
  onCommit,
}: {
  person: Person;
  onCommit: (patch: Partial<PersonUpdate>) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="px-4 py-3">
      <Link
        href="/contacts"
        className="inline-flex items-center gap-1 text-xs font-medium text-subtle transition-colors hover:text-brand"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> {t("contacts.backToContactsLower")}
      </Link>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <Avatar className="h-8 w-8 shrink-0">
          <AvatarFallback className="bg-brand-subtle text-xs font-semibold text-brand">
            {initials(person.name) || <UserRound className="h-4 w-4" />}
          </AvatarFallback>
        </Avatar>
        <EditableText
          value={person.name}
          onCommit={(name) => onCommit({ name })}
          placeholder={t("contacts.personNamePlaceholder")}
          className="-ms-1 min-w-0 font-heading text-lg font-bold text-foreground"
        />
        {person.jobTitle && (
          <>
            <span className="hidden h-4 w-px bg-gray-200 sm:block" />
            <span dir="auto" className="text-xs font-medium text-muted-foreground">
              {person.jobTitle}
            </span>
          </>
        )}
        {person.organizationId && person.organizationName && (
          <>
            <span className="hidden h-4 w-px bg-gray-200 sm:block" />
            <Link
              href={`/organization/${person.organizationId}`}
              className="text-xs text-brand hover:underline"
            >
              {person.organizationName}
            </Link>
          </>
        )}
        <span className="hidden h-4 w-px bg-gray-200 sm:block" />
        <span
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
          title={person.ownerName ?? t("common.unassigned")}
        >
          <Avatar className="h-4 w-4">
            <AvatarFallback className="bg-brand-subtle text-[9px] font-semibold text-brand">
              {initials(person.ownerName)}
            </AvatarFallback>
          </Avatar>
          <span className="max-w-[10rem] truncate">
            {person.ownerName ?? t("common.unassigned")}
          </span>
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          <Metric
            icon={<Handshake className="h-3.5 w-3.5" />}
            label={t("contacts.metric.deals")}
            value={person.dealCount ?? 0}
          />
        </div>
      </div>
    </div>
  );
}
