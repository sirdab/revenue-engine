import { Link } from "wouter";
import { ArrowLeft, Building2, Handshake, Users } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { initials } from "@/lib/format";
import { EditableText } from "@/components/deals/inline-edit";
import type { Organization, OrganizationUpdate } from "@workspace/api-client-react";
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

export function OrganizationHeader({
  organization,
  onCommit,
}: {
  organization: Organization;
  onCommit: (patch: Partial<OrganizationUpdate>) => void;
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
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-subtle text-brand">
          <Building2 className="h-4 w-4" />
        </span>
        <EditableText
          value={organization.name}
          onCommit={(name) => onCommit({ name })}
          placeholder={t("contacts.orgNamePlaceholder")}
          className="-ms-1 min-w-0 font-heading text-lg font-bold text-foreground"
        />
        <span className="hidden h-4 w-px bg-gray-200 sm:block" />
        <span
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
          title={organization.ownerName ?? t("common.unassigned")}
        >
          <Avatar className="h-4 w-4">
            <AvatarFallback className="bg-brand-subtle text-[9px] font-semibold text-brand">
              {initials(organization.ownerName)}
            </AvatarFallback>
          </Avatar>
          <span className="max-w-[10rem] truncate">
            {organization.ownerName ?? t("common.unassigned")}
          </span>
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          <Metric
            icon={<Handshake className="h-3.5 w-3.5" />}
            label={t("contacts.metric.deals")}
            value={organization.dealCount ?? 0}
          />
          <Metric
            icon={<Users className="h-3.5 w-3.5" />}
            label={t("contacts.metric.people")}
            value={organization.personCount ?? 0}
          />
        </div>
      </div>
    </div>
  );
}
