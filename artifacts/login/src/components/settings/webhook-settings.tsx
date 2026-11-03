import { useState } from "react";
import { Copy, Check, RefreshCw, Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  useWebhookSecret,
  useRotateWebhookSecret,
} from "@/lib/webhook-settings-api";

// The inbound webhooks, in integration order (create a deal, then update it).
// Each renders as a self-contained section: purpose, its own POST URL, the
// fields that matter, and an example body. They all share one secret (below).
const ENDPOINTS = [
  {
    id: "create",
    title: "Create a deal",
    path: "/api/webhooks/leads",
    summary:
      "Turn an inbound lead into a new deal. Creates and links a person and organization when provided.",
    fields: (
      <>
        <code className="font-mono">pipeline</code> accepts a name or id. Omit{" "}
        <code className="font-mono">stage</code> to drop into the pipeline's
        first stage. <code className="font-mono">externalId</code> makes retries
        safe: the same id never creates a duplicate deal.
      </>
    ),
    example: {
      pipeline: "Sales",
      title: "Acme Corp - Annual plan",
      value: 50000,
      ownerEmail: "owner@example.com",
      externalId: "n8n-{{ $json.id }}",
      labels: ["Inbound", "Hot"],
      person: {
        name: "Sara Al-Otaibi",
        email: "sara@acme.com",
        phone: "+15550100",
      },
      organization: { name: "Acme Corp" },
    },
  },
  {
    id: "update",
    title: "Update a deal",
    path: "/api/webhooks/deals/update",
    summary:
      "Patch an existing deal: move its stage, change its value, add a comment. Only the fields you send are changed.",
    fields: (
      <>
        Target the deal by its numeric <code className="font-mono">dealId</code>{" "}
        (returned when the deal is created). A{" "}
        <code className="font-mono">stage</code> change resets the deal's aging
        clock, just like editing it in the app.
      </>
    ),
    example: {
      dealId: 42,
      stage: "Proposal",
      value: 75000,
      comments: "Customer confirmed budget; sending contract.",
      labels: ["Hot"],
    },
  },
] as const;

function CopyButton({ value, label }: { value: string; label: string }) {
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
          toast({ title: "Couldn't copy", variant: "destructive" });
        }
      }}
    >
      {copied ? (
        <Check className="h-4 w-4 text-brand" />
      ) : (
        <Copy className="h-4 w-4" />
      )}
      <span className="ms-1.5">{copied ? "Copied" : label}</span>
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
  const url = `${origin}${endpoint.path}`;
  const example = JSON.stringify(endpoint.example, null, 2);
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="mb-1 flex items-center gap-2">
        <span className="rounded bg-primary px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-gray-100">
          POST
        </span>
        <h3 className="text-sm font-semibold text-foreground">
          {endpoint.title}
        </h3>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">{endpoint.summary}</p>

      <label className="text-xs font-medium text-muted-foreground">Endpoint</label>
      <div className="mb-3 mt-1 flex items-center gap-2">
        <Input readOnly value={url} className="font-mono text-xs" />
        <CopyButton value={url} label="Copy" />
      </div>

      <p className="mb-2 text-xs text-subtle">{endpoint.fields}</p>
      <pre className="overflow-x-auto rounded-md bg-primary p-3 text-xs leading-relaxed text-gray-100">
        {example}
      </pre>
    </section>
  );
}

export function WebhookSettings() {
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
        "Regenerate the webhook secret? The old secret stops working immediately; you'll need to update it in n8n.",
      )
    ) {
      return;
    }
    try {
      await rotate.mutateAsync();
      setReveal(true);
      toast({ title: "New secret generated" });
    } catch {
      toast({ title: "Couldn't regenerate secret", variant: "destructive" });
    }
  };

  return (
    <div className="mx-auto max-w-3xl p-6">
      <header className="mb-6">
        <h1 className="text-xl font-bold tracking-tight text-foreground">
          Integrations
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Create and update deals from external automations (n8n, Zapier,
          forms) by POSTing to the inbound webhooks below.
        </p>
      </header>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : isError ? (
        <div className="rounded-md border border-destructive/30 bg-destructive-subtle p-4 text-sm text-destructive">
          Couldn't load the webhook settings. Admins only.
        </div>
      ) : (
        <div className="space-y-6">
          {/* Authentication — one secret, shared by every endpoint below */}
          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="text-sm font-semibold text-foreground">
              Authentication
            </h2>
            <p className="mb-3 text-xs text-muted-foreground">
              Every endpoint below uses this one shared secret. Send it as an{" "}
              <code className="font-mono">
                Authorization: Bearer &lt;secret&gt;
              </code>{" "}
              header. Keep it private.
            </p>
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={reveal ? secret : masked}
                className="font-mono text-xs"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => setReveal((r) => !r)}
                aria-label={reveal ? "Hide secret" : "Reveal secret"}
              >
                {reveal ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </Button>
              <CopyButton value={secret} label="Copy" />
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
                <span className="ms-1.5">Regenerate</span>
              </Button>
            </div>
          </section>

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
