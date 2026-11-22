import { useState } from "react";
import { Copy, Check, RefreshCw, Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  useWebhookSecret,
  useRotateWebhookSecret,
} from "@/lib/webhook-settings-api";
import { SlackSettings } from "./slack-settings";
import { useI18n, type MessageKey } from "@/lib/i18n/i18n";

// The inbound webhooks, in integration order (create a deal, then update it).
// Each renders as a self-contained section: purpose, its own POST URL, the
// fields that matter, and an example body. They all share one secret (below).
// Titles and prose are message keys resolved at render; the example bodies are
// wire format and stay as the API expects them.
const code = (name: string) => (
  <code dir="ltr" className="font-mono">
    {name}
  </code>
);

const ENDPOINTS: {
  id: string;
  titleKey: MessageKey;
  path: string;
  summaryKey: MessageKey;
  fieldsKey: MessageKey;
  fieldCodes: Record<string, string>;
  example: Record<string, unknown>;
}[] = [
  {
    id: "create",
    titleKey: "settings.webhooks.create.title",
    path: "/api/webhooks/leads",
    summaryKey: "settings.webhooks.create.summary",
    fieldsKey: "settings.webhooks.create.fields",
    fieldCodes: {
      pipeline: "pipeline",
      stage: "stage",
      externalId: "externalId",
    },
    example: {
      pipeline: "Sales",
      title: "Acme Corp - Annual plan",
      value: 50000,
      ownerEmail: "owner@yourcompany.com",
      externalId: "n8n-{{ $json.id }}",
      labels: ["Inbound", "Hot"],
      person: {
        name: "Sara Lee",
        email: "sara@acme.com",
        phone: "+15550100",
      },
      organization: { name: "Acme Corp" },
    },
  },
  {
    id: "update",
    titleKey: "settings.webhooks.update.title",
    path: "/api/webhooks/deals/update",
    summaryKey: "settings.webhooks.update.summary",
    fieldsKey: "settings.webhooks.update.fields",
    fieldCodes: { dealId: "dealId", stage: "stage" },
    example: {
      dealId: 42,
      stage: "Proposal",
      value: 75000,
      comments: "Customer confirmed budget; sending contract.",
      labels: ["Hot"],
    },
  },
];

function CopyButton({ value, label }: { value: string; label: string }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="shrink-0"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          toast({ title: t("settings.webhooks.copyFailed"), variant: "destructive" });
        }
      }}
    >
      {copied ? (
        <Check className="h-4 w-4 text-brand" />
      ) : (
        <Copy className="h-4 w-4" />
      )}
      <span className="ms-1.5">{copied ? t("settings.webhooks.copied") : label}</span>
    </Button>
  );
}

function EndpointSection({
  origin,
  endpoint,
}: {
  origin: string;
  endpoint: (typeof ENDPOINTS)[number];
}) {
  const { t, tNode } = useI18n();
  const url = `${origin}${endpoint.path}`;
  const example = JSON.stringify(endpoint.example, null, 2);
  return (
    <section className="rounded-2xl bg-card p-5 shadow-card">
      <div className="mb-1 flex items-center gap-2">
        <span className="rounded-sm bg-primary px-1.5 py-0.5 font-mono text-caption text-gray-100">
          POST
        </span>
        <h3 className="text-body font-semibold text-foreground">
          {t(endpoint.titleKey)}
        </h3>
      </div>
      <p className="mb-3 text-caption-quiet text-muted-foreground">{t(endpoint.summaryKey)}</p>

      <label className="text-caption text-muted-foreground">
        {t("settings.webhooks.endpoint")}
      </label>
      <div className="mb-3 mt-1 flex items-center gap-2">
        <Input
          readOnly
          dir="ltr"
          value={url}
          aria-label={t("settings.webhooks.endpoint")}
          className="font-mono text-caption-quiet"
        />
        <CopyButton value={url} label={t("settings.webhooks.copy")} />
      </div>

      <p className="mb-2 text-caption-quiet text-subtle">{tNode(
          endpoint.fieldsKey,
          Object.fromEntries(
            Object.entries(endpoint.fieldCodes).map(([k, v]) => [k, code(v)]),
          ),
        )}
      </p>
      <pre dir="ltr" className="overflow-x-auto text-start rounded-md bg-primary p-3 text-caption-quiet leading-relaxed text-gray-100">
        {example}
      </pre>
    </section>
  );
}

export function WebhookSettings() {
  const { t, tNode } = useI18n();
  const { data, isLoading, isError } = useWebhookSecret();
  const rotate = useRotateWebhookSecret();
  const { toast } = useToast();
  const [reveal, setReveal] = useState(false);

  const origin =
    typeof window !== "undefined" ? window.location.origin : "";
  const secret = data?.secret ?? "";
  const masked = secret ? `${secret.slice(0, 6)}${"•".repeat(18)}` : "";

  const onRotate = async () => {
    if (
      !window.confirm(
        t("settings.webhooks.regenerateConfirm"),
      )
    ) {
      return;
    }
    try {
      await rotate.mutateAsync();
      setReveal(true);
      toast({ title: t("settings.webhooks.regenerated") });
    } catch {
      toast({
        title: t("settings.webhooks.regenerateFailed"),
        variant: "destructive",
      });
    }
  };

  return (
    <div className="mx-auto max-w-3xl p-6">
      <header className="mb-6">
        <h1 className="text-heading-sm text-foreground">
          {t("settings.integrations.title")}
        </h1>
        <p className="mt-1 text-body-quiet text-muted-foreground">
          {t("settings.integrations.subtitle")}
        </p>
      </header>

      {isLoading ? (
        <div className="flex items-center gap-2 text-body-quiet text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}
        </div>
      ) : isError ? (
        <div className="rounded-md border border-destructive/30 bg-destructive-subtle p-4 text-body-quiet text-destructive">
          {t("settings.webhooks.loadFailed")}
        </div>
      ) : (
        <div className="space-y-6">
          {/* Authentication — one secret, shared by every endpoint below */}
          <section className="rounded-2xl bg-card p-5 shadow-card">
            <h2 className="text-body font-semibold text-foreground">
              {t("settings.webhooks.auth.title")}
            </h2>
            <p className="mb-3 text-caption-quiet text-muted-foreground">
              {tNode("settings.webhooks.auth.description", {
                header: (
                  <code dir="ltr" className="font-mono">
                    Authorization: Bearer &lt;secret&gt;
                  </code>
                ),
              })}
            </p>
            <div className="flex items-center gap-2">
              <Input
                readOnly
                dir="ltr"
                value={reveal ? secret : masked}
                aria-label={t("settings.webhooks.auth.secret")}
                className="font-mono text-caption-quiet"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => setReveal((r) => !r)}
                aria-label={
                  reveal
                    ? t("settings.webhooks.auth.hide")
                    : t("settings.webhooks.auth.reveal")
                }
              >
                {reveal ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </Button>
              <CopyButton value={secret} label={t("settings.webhooks.copy")} />
            </div>
            <div className="mt-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onRotate}
                disabled={rotate.isPending}
              >
                {rotate.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                <span className="ms-1.5">{t("settings.webhooks.auth.regenerate")}</span>
              </Button>
            </div>
          </section>

          <SlackSettings />

          {/* One self-contained section per inbound webhook */}
          {ENDPOINTS.map((endpoint) => (
            <EndpointSection
              key={endpoint.id}
              origin={origin}
              endpoint={endpoint}
            />
          ))}
        </div>
      )}
    </div>
  );
}
