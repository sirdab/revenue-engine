import { useState } from "react";
import { Copy, Check, RefreshCw, Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  useWebhookSecret,
  useRotateWebhookSecret,
} from "@/lib/webhook-settings-api";
import { useI18n, type MessageKey } from "@/lib/i18n/i18n";

// Settings › Integrations › Webhooks: the workspace's inbound webhooks, which
// Zapier, n8n, Make or any HTTP client call to create and update deals.
//
// Every workspace posts to the same URLs; the workspace's own key, sent as
// `Authorization: Bearer <key>`, is what says which workspace a request is
// for (routes/webhooks.ts resolves the tenant from it, and anything without a
// valid key is a 401). So each endpoint below shows the full request, key
// included, rather than a bare URL.
//
// The endpoints, in integration order (create a deal, then update it).
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

/** A ready-to-run request, so the key is never left out by accident. */
function curlCommand(url: string, secret: string, body: Record<string, unknown>): string {
  return [
    `curl -X POST '${url}' \\`,
    `  -H 'Authorization: Bearer ${secret}' \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -d '${JSON.stringify(body).replace(/'/g, "'\\''")}'`,
  ].join("\n");
}

function EndpointSection({
  origin,
  endpoint,
  secret,
  maskedSecret,
}: {
  origin: string;
  endpoint: (typeof ENDPOINTS)[number];
  secret: string;
  maskedSecret: string;
}) {
  const { t, tNode } = useI18n();
  const url = `${origin}${endpoint.path}`;
  const example = JSON.stringify(endpoint.example, null, 2);
  return (
    <section className="rounded-xl border border-border bg-card p-4">
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

      <label className="text-caption text-muted-foreground">
        {t("settings.webhooks.headers")}
      </label>
      <pre dir="ltr" className="mb-3 mt-1 overflow-x-auto rounded-md bg-surface-whisper p-3 text-start font-mono text-caption-quiet leading-relaxed text-foreground">
        {`Authorization: Bearer ${maskedSecret}\nContent-Type: application/json`}
      </pre>

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
      <div className="mt-3 flex justify-end">
        <CopyButton
          value={curlCommand(url, secret, endpoint.example)}
          label={t("settings.webhooks.copyCurl")}
        />
      </div>
    </section>
  );
}

export function WebhooksPanel() {
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
    <div>
      {isLoading ? (
        <div className="flex items-center gap-2 text-body-quiet text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}
        </div>
      ) : isError ? (
        <div className="rounded-md border border-destructive/30 bg-destructive-subtle p-4 text-body-quiet text-destructive">
          {t("settings.webhooks.loadFailed")}
        </div>
      ) : (
        <div className="space-y-5">
          {/* The workspace's key, shared by every endpoint below */}
          <section className="rounded-xl border border-border bg-card p-4">
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

          {/* One self-contained section per inbound webhook */}
          {ENDPOINTS.map((endpoint) => (
            <EndpointSection
              key={endpoint.id}
              origin={origin}
              endpoint={endpoint}
              secret={secret}
              maskedSecret={reveal ? secret : masked}
            />
          ))}
        </div>
      )}
    </div>
  );
}
