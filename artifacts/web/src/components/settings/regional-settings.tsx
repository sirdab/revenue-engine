import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetCurrentUserQueryKey,
  getGetWorkspaceQueryKey,
  useGetWorkspace,
  useUpdateWorkspace,
  type WorkspaceUpdate,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/api-error";
import { useI18n } from "@/lib/i18n/i18n";
import { SectionCard } from "./section-card";

// Settings › Workspace › Regional: the workspace's time zone, first day of the
// week, default currency, phone calling code and default language. Each field
// can be left on "server default" (stored as null), and the hint under it
// says what is in effect. The server validates every value
// (api-server/src/lib/workspace-settings.ts); this form only offers valid ones.

const DEFAULT = "__default__";

type Draft = {
  timezone: string | null;
  weekStart: 0 | 1 | 6 | null;
  defaultCurrency: string | null;
  phoneCountryCode: string | null;
  defaultLocale: "en" | "ar" | null;
};

/** "GMT+03:00"-style offset of a zone right now, for the picker labels. */
function zoneOffset(zone: string): string {
  try {
    const part = new Intl.DateTimeFormat("en", { timeZone: zone, timeZoneName: "longOffset" })
      .formatToParts(new Date())
      .find((p) => p.type === "timeZoneName");
    return part?.value ?? "";
  } catch {
    return "";
  }
}

export function RegionalSettings() {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: workspace, isLoading, isError } = useGetWorkspace();
  const update = useUpdateWorkspace();
  // Only the fields the admin has touched; the rest show what's saved.
  const [draft, setDraft] = useState<Partial<Draft>>({});

  const zones = useMemo(
    () =>
      ["UTC", ...Intl.supportedValuesOf("timeZone").filter((z) => z !== "UTC")].map((z) => {
        const offset = zoneOffset(z);
        return { value: z, label: offset ? `${z.replace(/_/g, " ")} (${offset})` : z };
      }),
    [],
  );
  const currencies = useMemo(() => {
    const names = new Intl.DisplayNames([locale], { type: "currency" });
    return Intl.supportedValuesOf("currency").map((c) => ({
      value: c,
      label: `${c} — ${names.of(c) ?? c}`,
    }));
  }, [locale]);

  if (isLoading) {
    return (
      <SectionCard title={t("settings.regional.title")} description={t("settings.regional.description")}>
        <div className="flex items-center gap-2 px-5 py-4 text-body-quiet text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}
        </div>
      </SectionCard>
    );
  }
  if (isError || !workspace) {
    return (
      <SectionCard title={t("settings.regional.title")} description={t("settings.regional.description")}>
        <p className="px-5 py-4 text-body text-destructive">{t("settings.workspace.loadFailed")}</p>
      </SectionCard>
    );
  }

  const saved = workspace.regional as Draft;
  const effective = workspace.effectiveRegional;
  const value = <K extends keyof Draft>(k: K): Draft[K] => (k in draft ? (draft[k] as Draft[K]) : saved[k]);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const phone = value("phoneCountryCode") ?? "";
  const phoneValid = phone === "" || /^[1-9][0-9]{0,3}$/.test(phone);
  const changes = (Object.keys(draft) as (keyof Draft)[]).filter((k) => draft[k] !== saved[k]);
  const dirty = changes.length > 0;

  const weekName = (w: number) =>
    w === 6 ? t("settings.regional.week.saturday") : w === 0 ? t("settings.regional.week.sunday") : t("settings.regional.week.monday");

  const save = async () => {
    if (!dirty || !phoneValid) return;
    const body: WorkspaceUpdate = {};
    for (const k of changes) (body as Record<string, unknown>)[k] = draft[k] === "" ? null : draft[k];
    try {
      const next = await update.mutateAsync({ data: body });
      queryClient.setQueryData(getGetWorkspaceQueryKey(), next);
      // The app reads zone, week and currency from the signed-in user's
      // workspace, so refresh that too.
      await queryClient.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() });
      setDraft({});
      toast({ title: t("settings.regional.saved") });
    } catch (err) {
      toast({ title: t("settings.regional.saveFailed"), description: errorMessage(err), variant: "destructive" });
    }
  };

  return (
    <SectionCard title={t("settings.regional.title")} description={t("settings.regional.description")}>
      <form
        className="grid gap-5 px-5 py-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="space-y-1.5 sm:col-span-2">
          <Label>{t("settings.regional.timezone")}</Label>
          <Combobox
            items={zones}
            value={value("timezone") ?? DEFAULT}
            onChange={(v) => set("timezone", v === DEFAULT ? null : v)}
            allValue={DEFAULT}
            allLabel={t("settings.regional.serverDefault")}
            placeholder={t("settings.regional.searchTimezone")}
            renderCap={1000}
            triggerClassName="w-full"
          />
          <p className="text-caption-quiet text-subtle">
            {t("settings.regional.timezoneHint", { value: effective.timezone })}
          </p>
        </div>

        <div className="space-y-1.5">
          <Label>{t("settings.regional.weekStart")}</Label>
          <Select
            value={value("weekStart") == null ? DEFAULT : String(value("weekStart"))}
            onValueChange={(v) => set("weekStart", v === DEFAULT ? null : (Number(v) as 0 | 1 | 6))}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DEFAULT}>{t("settings.regional.serverDefault")}</SelectItem>
              <SelectItem value="6">{t("settings.regional.week.saturday")}</SelectItem>
              <SelectItem value="0">{t("settings.regional.week.sunday")}</SelectItem>
              <SelectItem value="1">{t("settings.regional.week.monday")}</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-caption-quiet text-subtle">
            {t("settings.regional.inEffect", { value: weekName(effective.weekStart) })}
          </p>
        </div>

        <div className="space-y-1.5">
          <Label>{t("settings.regional.language")}</Label>
          <Select
            value={value("defaultLocale") ?? DEFAULT}
            onValueChange={(v) => set("defaultLocale", v === DEFAULT ? null : (v as "en" | "ar"))}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DEFAULT}>{t("settings.regional.language.memberChoice")}</SelectItem>
              <SelectItem value="ar">العربية</SelectItem>
              <SelectItem value="en">English</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-caption-quiet text-subtle">{t("settings.regional.languageHint")}</p>
        </div>

        <div className="space-y-1.5">
          <Label>{t("settings.regional.currency")}</Label>
          <Combobox
            items={currencies}
            value={value("defaultCurrency") ?? DEFAULT}
            onChange={(v) => set("defaultCurrency", v === DEFAULT ? null : v)}
            allValue={DEFAULT}
            allLabel={t("settings.regional.serverDefault")}
            placeholder={t("settings.regional.searchCurrency")}
            renderCap={400}
            triggerClassName="w-full"
          />
          <p className="text-caption-quiet text-subtle">
            {saved.defaultCurrency
              ? t("settings.regional.currencyHint")
              : t("settings.regional.currencyHintDefault", { value: effective.defaultCurrency })}
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="phone-code">{t("settings.regional.phoneCode")}</Label>
          <div dir="ltr" className="flex items-center gap-2">
            <span className="text-body text-muted-foreground">+</span>
            <Input
              id="phone-code"
              inputMode="numeric"
              maxLength={4}
              value={phone}
              onChange={(e) => set("phoneCountryCode", e.target.value.replace(/[^0-9]/g, "") || null)}
              placeholder={effective.phoneCountryCode ?? "966"}
              aria-invalid={!phoneValid}
            />
          </div>
          <p className={phoneValid ? "text-caption-quiet text-subtle" : "text-caption-quiet text-destructive"}>
            {phoneValid ? t("settings.regional.phoneHint") : t("settings.regional.phoneInvalid")}
          </p>
        </div>

        <div className="flex items-center gap-3 sm:col-span-2">
          <Button type="submit" disabled={!dirty || !phoneValid || update.isPending}>
            {update.isPending && <Loader2 className="me-1.5 h-4 w-4 animate-spin" />}
            {t("common.save")}
          </Button>
          {dirty && (
            <Button type="button" variant="ghost" onClick={() => setDraft({})} disabled={update.isPending}>
              {t("common.cancel")}
            </Button>
          )}
        </div>
      </form>
    </SectionCard>
  );
}
