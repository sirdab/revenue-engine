import { Label } from "@/components/ui/label";
import { AsyncSelect } from "@/components/ui/async-select";
import { useI18n } from "@/lib/i18n/i18n";
import { loadDealOptions, loadPersonOptions } from "@/lib/contacts-search-api";

// The deal and person a deal activity hangs off, picked by search. Shared by
// the edit dialog and the composer's dialog variant.

export interface ActivityLinks {
  dealId: number | null;
  dealLabel: string | null;
  personId: number | null;
  personLabel: string | null;
}

export const NO_LINKS: ActivityLinks = {
  dealId: null,
  dealLabel: null,
  personId: null,
  personLabel: null,
};

export function LinkFields({
  value,
  onChange,
}: {
  value: ActivityLinks;
  onChange: (next: ActivityLinks) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="min-w-0 space-y-1.5">
        <Label>{t("common.deal")}</Label>
        <AsyncSelect
          value={value.dealId != null ? String(value.dealId) : null}
          valueLabel={value.dealLabel}
          loadOptions={loadDealOptions}
          onChange={(v, label) =>
            onChange({ ...value, dealId: v ? Number(v) : null, dealLabel: label })
          }
          allValue=""
          allLabel={t("activity.add.noDeal")}
          placeholder={t("common.searchDeals")}
          triggerClassName="w-full"
        />
      </div>
      <div className="min-w-0 space-y-1.5">
        <Label>{t("common.person")}</Label>
        <AsyncSelect
          value={value.personId != null ? String(value.personId) : null}
          valueLabel={value.personLabel}
          loadOptions={loadPersonOptions}
          onChange={(v, label) =>
            onChange({ ...value, personId: v ? Number(v) : null, personLabel: label })
          }
          allValue=""
          allLabel={t("activity.add.noPerson")}
          placeholder={t("common.searchPeople")}
          triggerClassName="w-full"
        />
      </div>
    </div>
  );
}
