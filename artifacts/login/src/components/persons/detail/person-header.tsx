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
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-whisper px-2.5 py-1 text-caption text-muted-foreground">
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
        className="inline-flex items-center gap-1 text-caption text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> {t("contacts.backToContactsLower")}
      </Link>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <Avatar className="shrink-0">
          <AvatarFallback>
            {initials(person.name) || <UserRound className="h-4 w-4" />}
          </AvatarFallback>
        </Avatar>
        <EditableText
          value={person.name}
          onCommit={(name) => onCommit({ name })}
          placeholder={t("contacts.personNamePlaceholder")}
          className="-ms-1 min-w-0 text-heading-sm text-foreground"
        />
        {person.jobTitle && (
          <>
            <span className="hidden h-4 w-px bg-border sm:block" />
            <span dir="auto" className="text-caption font-medium text-muted-foreground">
              {person.jobTitle}
            </span>
          </>
        )}
        {person.organizationId && person.organizationName && (
          <>
            <span className="hidden h-4 w-px bg-border sm:block" />
            <Link
              href={`/organization/${person.organizationId}`}
              className="text-caption text-foreground underline-offset-2 hover:underline"
            >
              {person.organizationName}
            </Link>
          </>
        )}
        <span className="hidden h-4 w-px bg-border sm:block" />
        <span
          className="inline-flex items-center gap-1.5 text-caption text-muted-foreground"
          title={person.ownerName ?? t("common.unassigned")}
        >
          <Avatar size="sm" className="size-4">
            <AvatarFallback className="text-badge">
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
