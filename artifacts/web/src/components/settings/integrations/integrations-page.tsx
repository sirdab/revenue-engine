import { useMemo, useState, type ReactNode } from "react";
import { ArrowUpRight, Search, Webhook } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useI18n, type MessageKey } from "@/lib/i18n/i18n";
import { useAiSettings } from "@/lib/ai-settings-api";
import { useSlackSettings } from "@/lib/webhook-settings-api";
import { AiSettings } from "../ai-settings";
import { SlackSettings } from "../slack-settings";
import { WebhooksPanel } from "../webhook-settings";
import { BRAND_COLOR, BrandLogo, type BrandId } from "./logos";

// Settings › Integrations, laid out as a small marketplace: one card per
// service, filterable by category, each opening its setup in a side panel.
//
// Zapier, n8n and Make have no connector of their own: they call the
// workspace's inbound webhooks. Their cards say so and open the webhooks
// panel, with a line on where to paste the URL and key in that tool.

type Category = "communication" | "ai" | "automation";
type Panel = "slack" | "ai" | "webhooks";
type Status = "connected" | "notConnected" | "ready" | "viaWebhooks";

interface IntegrationDef {
  id: string;
  name: string;
  logo: BrandId | "webhook";
  category: Category;
  descKey: MessageKey;
  panel: Panel;
  /** For the AI providers: the provider to preselect in the panel. */
  provider?: "openai" | "anthropic";
  /** For tools that connect through webhooks: how to do it there. */
  tipKey?: MessageKey;
  docsUrl?: string;
}

const INTEGRATIONS: IntegrationDef[] = [
  { id: "slack", name: "Slack", logo: "slack", category: "communication", descKey: "settings.integrations.slack.desc", panel: "slack" },
  { id: "openai", name: "OpenAI", logo: "openai", category: "ai", descKey: "settings.integrations.openai.desc", panel: "ai", provider: "openai" },
  { id: "anthropic", name: "Anthropic", logo: "anthropic", category: "ai", descKey: "settings.integrations.anthropic.desc", panel: "ai", provider: "anthropic" },
  { id: "webhooks", name: "Webhooks", logo: "webhook", category: "automation", descKey: "settings.integrations.webhooks.desc", panel: "webhooks" },
  { id: "zapier", name: "Zapier", logo: "zapier", category: "automation", descKey: "settings.integrations.zapier.desc", panel: "webhooks", tipKey: "settings.integrations.zapier.tip", docsUrl: "https://zapier.com/apps/webhook/integrations" },
  { id: "n8n", name: "n8n", logo: "n8n", category: "automation", descKey: "settings.integrations.n8n.desc", panel: "webhooks", tipKey: "settings.integrations.n8n.tip", docsUrl: "https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest/" },
  { id: "make", name: "Make", logo: "make", category: "automation", descKey: "settings.integrations.make.desc", panel: "webhooks", tipKey: "settings.integrations.make.tip", docsUrl: "https://www.make.com/en/help/tools/http" },
];

const CATEGORIES: { id: Category | "all"; labelKey: MessageKey }[] = [
  { id: "all", labelKey: "settings.integrations.category.all" },
  { id: "communication", labelKey: "settings.integrations.category.communication" },
  { id: "ai", labelKey: "settings.integrations.category.ai" },
  { id: "automation", labelKey: "settings.integrations.category.automation" },
];

function Logo({ logo, size = "md" }: { logo: IntegrationDef["logo"]; size?: "md" | "lg" }) {
  const box = size === "lg" ? "h-12 w-12 rounded-xl" : "h-11 w-11 rounded-xl";
  const glyph = size === "lg" ? "h-6 w-6" : "h-[22px] w-[22px]";
  if (logo === "webhook") {
    return (
      <span className={cn(box, "flex shrink-0 items-center justify-center bg-brand-subtle text-brand ring-1 ring-border")}>
        <Webhook className={glyph} />
      </span>
    );
  }
  return (
    <span
      className={cn(box, "flex shrink-0 items-center justify-center bg-card ring-1 ring-border")}
      style={{ color: BRAND_COLOR[logo] }}
    >
      <BrandLogo brand={logo} className={cn(glyph, "dark:invert-[.85]")} />
    </span>
  );
}

function StatusBadge({ status }: { status: Status }) {
  const { t } = useI18n();
  const tone = status === "connected" || status === "ready" ? "success" : "neutral";
  return (
    <Badge tone={tone} className="shrink-0">
      {t(`settings.integrations.status.${status}` as MessageKey)}
    </Badge>
  );
}

export function IntegrationsPage() {
  const { t } = useI18n();
  const slack = useSlackSettings();
  const ai = useAiSettings();
  const [category, setCategory] = useState<Category | "all">("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<IntegrationDef | null>(null);

  const statusOf = (it: IntegrationDef): Status => {
    if (it.panel === "slack") {
      return slack.data?.botTokenSet || slack.data?.webhookUrlSet ? "connected" : "notConnected";
    }
    if (it.panel === "ai") {
      return ai.data?.enabled && ai.data.provider === it.provider ? "connected" : "notConnected";
    }
    // Every workspace has a webhook key from the start.
    return it.id === "webhooks" ? "ready" : "viaWebhooks";
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return INTEGRATIONS.filter(
      (it) =>
        (category === "all" || it.category === category) &&
        (!q || it.name.toLowerCase().includes(q) || t(it.descKey).toLowerCase().includes(q)),
    );
  }, [category, query, t]);

  const connectedCount = INTEGRATIONS.filter((it) => statusOf(it) === "connected").length;

  return (
    <div className="mx-auto max-w-5xl p-6">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-heading-sm text-foreground">{t("settings.integrations.title")}</h1>
          <p className="mt-1 max-w-2xl text-body-quiet text-muted-foreground">
            {t("settings.integrations.marketSubtitle")}
          </p>
        </div>
        <p className="text-caption text-muted-foreground">
          {t("settings.integrations.connectedCount", { count: connectedCount, total: INTEGRATIONS.length })}
        </p>
      </header>

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" className="flex flex-wrap gap-1.5">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={category === c.id}
              onClick={() => setCategory(c.id)}
              className={cn(
                "rounded-full px-3 py-1.5 text-body-quiet font-medium transition-colors",
                category === c.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-gray-alpha-50 text-muted-foreground hover:text-foreground",
              )}
            >
              {t(c.labelKey)}
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("settings.integrations.search")}
            aria-label={t("settings.integrations.search")}
            inputClassName="ps-9"
          />
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-10 text-center text-body-quiet text-muted-foreground">
          {t("settings.integrations.noResults")}
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((it) => {
            const status = statusOf(it);
            return (
              <button
                key={it.id}
                type="button"
                onClick={() => setOpen(it)}
                className="group flex flex-col rounded-2xl bg-card p-5 text-start shadow-card ring-1 ring-transparent transition-all hover:-translate-y-0.5 hover:ring-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <div className="mb-4 flex items-start justify-between gap-3">
                  <Logo logo={it.logo} />
                  <StatusBadge status={status} />
                </div>
                <h2 className="text-body font-semibold text-foreground">{it.name}</h2>
                <p className="mt-1 line-clamp-3 flex-1 text-body-quiet text-muted-foreground">{t(it.descKey)}</p>
                <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
                  <span className="text-caption text-subtle">
                    {t(CATEGORIES.find((c) => c.id === it.category)!.labelKey)}
                  </span>
                  <span className="text-body-quiet font-medium text-foreground group-hover:underline group-hover:underline-offset-4">
                    {status === "connected" ? t("settings.integrations.manage") : t("settings.integrations.connect")}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <Sheet side="end" open={open !== null} onOpenChange={(v) => !v && setOpen(null)}>
        <SheetContent className="flex w-full flex-col overflow-y-auto p-0 sm:max-w-xl">
          {open && (
            <>
              <SheetHeader className="border-b border-border px-6 py-5">
                <div className="flex items-center gap-3">
                  <Logo logo={open.logo} size="lg" />
                  <div className="min-w-0">
                    <SheetTitle className="text-heading-xs text-foreground">{open.name}</SheetTitle>
                    <SheetDescription className="text-body-quiet text-muted-foreground">
                      {t(open.descKey)}
                    </SheetDescription>
                  </div>
                </div>
              </SheetHeader>
              <div className="space-y-5 px-6 py-5">
                {open.tipKey && (
                  <TipBox docsUrl={open.docsUrl} name={open.name}>
                    {t(open.tipKey)}
                  </TipBox>
                )}
                {open.panel === "slack" && <SlackSettings embedded />}
                {open.panel === "ai" && <AiSettings embedded initialProvider={open.provider} />}
                {open.panel === "webhooks" && <WebhooksPanel />}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function TipBox({ children, docsUrl, name }: { children: ReactNode; docsUrl?: string; name: string }) {
  const { t } = useI18n();
  return (
    <div className="rounded-xl bg-brand-subtle p-4 text-body-quiet text-foreground">
      <p>{children}</p>
      {docsUrl && (
        <Button asChild variant="link" size="sm" className="mt-1 h-auto px-0 text-brand">
          <a href={docsUrl} target="_blank" rel="noreferrer">
            {t("settings.integrations.docs", { name })}
            <ArrowUpRight className="ms-1 h-3.5 w-3.5" />
          </a>
        </Button>
      )}
    </div>
  );
}
