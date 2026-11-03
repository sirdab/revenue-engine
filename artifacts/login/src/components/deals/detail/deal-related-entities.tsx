import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  User,
  Building2,
  Mail,
  Phone,
  ArrowUpRight,
  Pencil,
  Plus,
  Check,
  X,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { DealSectionCard, DealField } from "./deal-section-card";
import {
  getGetDealQueryKey,
  useUpdatePerson,
  useUpdateOrganization,
  type Deal,
  type Person,
  type Organization,
  type PersonUpdate,
  type OrganizationUpdate,
} from "@workspace/api-client-react";
import { useI18n, type MessageKey } from "@/lib/i18n/i18n";
import {
  invalidatePersonCaches,
  invalidateOrganizationCaches,
} from "@/lib/contact-cache";

type Tab = "person" | "organization";

const TABS: { key: Tab; label: MessageKey; icon: typeof User }[] = [
  { key: "person", label: "common.person", icon: User },
  { key: "organization", label: "common.organization", icon: Building2 },
];

function EmptyPanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-200 py-6 text-center text-sm text-slate-400">
      {children}
    </div>
  );
}

function RelatedEditableField({
  label,
  value,
  type = "text",
  multiline = false,
  required = false,
  addLabel,
  renderDisplay,
  editing,
  onStartEdit,
  onStopEdit,
  onSave,
  className,
}: {
  label: string;
  value?: string | null;
  type?: "text" | "email" | "tel";
  multiline?: boolean;
  required?: boolean;
  addLabel?: string;
  renderDisplay?: (value: string) => ReactNode;
  editing: boolean;
  onStartEdit: () => void;
  onStopEdit: () => void;
  onSave: (next: string | null) => Promise<void>;
  className?: string;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [draft, setDraft] = useState(value ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pencilRef = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);

  useEffect(() => {
    if (editing) {
      setDraft(value ?? "");
      setError(null);
    }
  }, [editing, value]);

  useEffect(() => {
    if (wasEditing.current && !editing) pencilRef.current?.focus();
    wasEditing.current = editing;
  }, [editing]);

  async function save() {
    if (saving) return;
    const trimmed = draft.trim();
    if (required && trimmed === "") {
      setError(t("deals.related.cannotBeEmpty", { field: label }));
      return;
    }
    setSaving(true);
    try {
      await onSave(trimmed === "" ? null : trimmed);
      onStopEdit();
    } catch {
      toast({ title: t("dealDetail.updateFailed"), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <DealField label={label} className={className}>
        <div className="space-y-2">
          {multiline ? (
            <textarea
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                if (error) setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") onStopEdit();
                else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void save();
                }
              }}
              rows={2}
              disabled={saving}
              className="min-h-[56px] w-full rounded-md border border-slate-300 bg-card px-2.5 py-1.5 text-sm focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/30 disabled:opacity-60"
              autoFocus
            />
          ) : (
            <Input
              type={type}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                if (error) setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") onStopEdit();
                else if (e.key === "Enter") {
                  e.preventDefault();
                  void save();
                }
              }}
              className="h-8"
              disabled={saving}
              autoFocus
            />
          )}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="h-8"
              onClick={() => void save()}
              disabled={saving}
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}{" "}
              {t("common.save")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8"
              onClick={onStopEdit}
              disabled={saving}
            >
              <X className="h-3.5 w-3.5" /> {t("common.cancel")}
            </Button>
            {error ? (
              <span className="text-xs text-red-600">{error}</span>
            ) : (
              multiline && (
                <span className="text-xs text-slate-400">
                  {t("deals.related.editorHint")}
                </span>
              )
            )}
          </div>
        </div>
      </DealField>
    );
  }

  const hasValue = value != null && value !== "";
  return (
    <DealField label={label} className={className}>
      <div className="flex items-center gap-2">
        {hasValue ? (
          renderDisplay ? (
            renderDisplay(value as string)
          ) : (
            <span className="break-words">{value}</span>
          )
        ) : required ? (
          <span className="text-slate-400">—</span>
        ) : (
          <button
            ref={pencilRef}
            type="button"
            onClick={onStartEdit}
            className="inline-flex items-center gap-1 text-sm text-teal-700 hover:underline"
          >
            <Plus className="h-3.5 w-3.5" />{" "}
            {addLabel ?? t("deals.related.addField", { field: label.toLowerCase() })}
          </button>
        )}
        {hasValue && (
          <button
            ref={pencilRef}
            type="button"
            onClick={onStartEdit}
            aria-label={t("deals.related.editField", { field: label.toLowerCase() })}
            className="ms-auto shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </DealField>
  );
}

function PersonPanel({
  dealId,
  person,
  personName,
}: {
  dealId: number;
  person?: Person;
  personName?: string | null;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const updatePerson = useUpdatePerson();
  const [editingField, setEditingField] = useState<string | null>(null);

  if (!person && !personName) {
    return <EmptyPanel>{t("deals.related.noPerson")}</EmptyPanel>;
  }

  if (!person?.id) {
    return (
      <div className="grid grid-cols-2 gap-x-4 gap-y-4">
        <DealField label={t("common.name")} value={personName} className="col-span-2" />
      </div>
    );
  }

  const personId = person.id;
  const commit = async (patch: Partial<PersonUpdate>) => {
    await updatePerson.mutateAsync({ id: personId, data: patch });
    queryClient.invalidateQueries({ queryKey: getGetDealQueryKey(dealId) });
    invalidatePersonCaches(queryClient, personId, { renamed: "name" in patch });
  };

  const startEdit = (field: string) => () => setEditingField(field);
  const stopEdit = () => setEditingField(null);

  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-4">
      <RelatedEditableField
        label={t("common.name")}
        value={person.name}
        required
        editing={editingField === "name"}
        onStartEdit={startEdit("name")}
        onStopEdit={stopEdit}
        onSave={(v) => commit({ name: v ?? "" })}
        className="col-span-2"
      />
      <RelatedEditableField
        label={t("common.jobTitle")}
        value={person.jobTitle}
        addLabel={t("deals.related.addJobTitle")}
        editing={editingField === "jobTitle"}
        onStartEdit={startEdit("jobTitle")}
        onStopEdit={stopEdit}
        onSave={(v) => commit({ jobTitle: v })}
        className="col-span-2"
      />
      <RelatedEditableField
        label={t("common.email")}
        type="email"
        value={person.email}
        addLabel={t("deals.related.addEmail")}
        editing={editingField === "email"}
        onStartEdit={startEdit("email")}
        onStopEdit={stopEdit}
        onSave={(v) => commit({ email: v })}
        renderDisplay={(email) => (
          <a
            href={`mailto:${email}`}
            title={email}
            className="flex min-w-0 items-center gap-1.5 text-teal-700 hover:underline"
          >
            <Mail className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{email}</span>
          </a>
        )}
      />
      <RelatedEditableField
        label={t("common.phone")}
        type="tel"
        value={person.phone}
        addLabel={t("deals.related.addPhone")}
        editing={editingField === "phone"}
        onStartEdit={startEdit("phone")}
        onStopEdit={stopEdit}
        onSave={(v) => commit({ phone: v })}
        renderDisplay={(phone) => (
          <a
            href={`tel:${phone}`}
            className="inline-flex items-center gap-1.5 text-teal-700 hover:underline"
          >
            <Phone className="h-3.5 w-3.5" /> {phone}
          </a>
        )}
      />
      <DealField label={t("common.organization")} value={person.organizationName} />
    </div>
  );
}

function OrganizationPanel({
  dealId,
  organization,
  organizationName,
  organizationId,
}: {
  dealId: number;
  organization?: Organization;
  organizationName?: string | null;
  organizationId?: number | null;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const updateOrganization = useUpdateOrganization();
  const [editingField, setEditingField] = useState<string | null>(null);

  if (!organization && !organizationName) {
    return <EmptyPanel>{t("deals.related.noOrg")}</EmptyPanel>;
  }

  if (!organization?.id) {
    return (
      <div className="grid grid-cols-2 gap-x-4 gap-y-4">
        <DealField label={t("common.name")} className="col-span-2">
          {organizationId != null ? (
            <Link
              href={`/organization/${organizationId}`}
              className="inline-flex items-center gap-1 font-medium text-teal-700 hover:underline"
            >
              {organizationName}
              <ArrowUpRight className="h-3.5 w-3.5 shrink-0" />
            </Link>
          ) : (
            organizationName ?? <span className="text-slate-400">—</span>
          )}
        </DealField>
      </div>
    );
  }

  const orgId = organization.id;
  const commit = async (patch: Partial<OrganizationUpdate>) => {
    await updateOrganization.mutateAsync({ id: orgId, data: patch });
    queryClient.invalidateQueries({ queryKey: getGetDealQueryKey(dealId) });
    invalidateOrganizationCaches(queryClient, orgId, { renamed: "name" in patch });
  };

  const startEdit = (field: string) => () => setEditingField(field);
  const stopEdit = () => setEditingField(null);

  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-4">
      <RelatedEditableField
        label={t("common.name")}
        value={organization.name}
        required
        editing={editingField === "name"}
        onStartEdit={startEdit("name")}
        onStopEdit={stopEdit}
        onSave={(v) => commit({ name: v ?? "" })}
        className="col-span-2"
        renderDisplay={(name) => (
          <Link
            href={`/organization/${orgId}`}
            className="inline-flex items-center gap-1 font-medium text-teal-700 hover:underline"
          >
            {name}
            <ArrowUpRight className="h-3.5 w-3.5 shrink-0" />
          </Link>
        )}
      />
      <RelatedEditableField
        label={t("common.address")}
        value={organization.address}
        multiline
        addLabel={t("deals.related.addValue")}
        editing={editingField === "address"}
        onStartEdit={startEdit("address")}
        onStopEdit={stopEdit}
        onSave={(v) => commit({ address: v })}
        className="col-span-2"
      />
      <DealField label={t("common.owner")} value={organization.ownerName} />
      <DealField label={t("deals.forecast.openDeals")} value={organization.dealCount ?? undefined} />
      <DealField label={t("deals.related.people")} value={organization.personCount ?? undefined} />
    </div>
  );
}

export function DealRelatedEntities({
  deal,
  person,
  organization,
}: {
  deal: Deal;
  person?: Person;
  organization?: Organization;
}) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("person");

  return (
    <DealSectionCard title={t("deals.related.title")}>
      <div className="mb-4 flex items-center gap-0.5 rounded-lg border border-slate-200 bg-slate-50 p-0.5">
        {TABS.map(({ key, label: labelKey, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
              tab === key
                ? "bg-card text-teal-700 shadow-sm"
                : "text-slate-500 hover:text-slate-700",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t(labelKey)}</span>
          </button>
        ))}
      </div>

      {tab === "person" && (
        <PersonPanel
          dealId={deal.id}
          person={person}
          personName={deal.personName}
        />
      )}

      {tab === "organization" && (
        <OrganizationPanel
          dealId={deal.id}
          organization={organization}
          organizationName={deal.organizationName}
          organizationId={deal.organizationId}
        />
      )}
    </DealSectionCard>
  );
}
