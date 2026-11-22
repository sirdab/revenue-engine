import { useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n/i18n";
import {
  useAiSettings,
  useTestAiConnection,
  useUpdateAiSettings,
  type AiProvider,
  type AiSettingsUpdate,
} from "@/lib/ai-settings-api";

// Settings › Integrations › AI assistant: the workspace's own OpenAI or
// Anthropic key, which powers Ask AI and is billed to the workspace's own
// provider account. The key is write-only, so its input starts empty and a
// blank input on Save leaves the stored key alone. Switching provider needs a
// new key, since the stored one belongs to the other provider.

const PROVIDERS: { value: AiProvider; label: string; placeholder: string; keysUrl: string }[] = [
  { value: "openai", label: "OpenAI", placeholder: "sk-…", keysUrl: "https://platform.openai.com/api-keys" },
  {
    value: "anthropic",
    label: "Anthropic",
    placeholder: "sk-ant-…",
    keysUrl: "https://console.anthropic.com/settings/keys",
  },
];

export function AiSettings({
  embedded = false,
  initialProvider,
}: {
  embedded?: boolean;
  /** Preselected when opened from a provider's card. */
  initialProvider?: AiProvider;
} = {}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const { data, isLoading, isError } = useAiSettings();
  const update = useUpdateAiSettings();
  const test = useTestAiConnection();
  // null = untouched, so the controls show what is stored until edited.
  const [provider, setProvider] = useState<AiProvider | null>(initialProvider ?? null);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState<string | null>(null);

  const send = async (body: AiSettingsUpdate, done: string) => {
    try {
      await update.mutateAsync(body);
      setProvider(null);
      setApiKey("");
      setModel(null);
      toast({ title: done });
    } catch (err) {
      toast({
        title: t("settings.ai.saveFailed"),
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    }
  };

  if (isLoading) {
    return (
      <Section embedded={embedded}>
        <div className="flex items-center gap-2 text-body-quiet text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}
        </div>
      </Section>
    );
  }
  if (isError || !data) {
    return (
      <Section embedded={embedded}>
        <p className="text-body text-destructive">{t("settings.ai.loadFailed")}</p>
      </Section>
    );
  }

  const chosen = provider ?? data.provider ?? "openai";
  const meta = PROVIDERS.find((p) => p.value === chosen)!;
  const providerChanged = data.keySet && chosen !== data.provider;
  // A key stored for the chosen provider can be kept; otherwise one is needed.
  const keepsKey = data.keySet && !providerChanged;
  const modelValue = model ?? (providerChanged ? "" : (data.model ?? ""));
  const dirty = Boolean(apiKey.trim()) || model !== null || (provider !== null && provider !== data.provider);
  const canSave = dirty && (keepsKey || Boolean(apiKey.trim()));

  const save = () =>
    void send(
      {
        provider: chosen,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        ...(model !== null ? { model: model.trim() || null } : {}),
      },
      t("settings.ai.saved"),
    );

  const toggle = (enabled: boolean) =>
    void send({ enabled }, enabled ? t("settings.ai.turnedOn") : t("settings.ai.turnedOff"));

  const disconnect = () => {
    if (!window.confirm(t("settings.ai.disconnectConfirm"))) return;
    void send({ apiKey: null }, t("settings.ai.disconnected"));
  };

  const runTest = async () => {
    try {
      const result = await test.mutateAsync();
      toast(
        result.ok
          ? { title: t("settings.ai.testOk") }
          : { title: t("settings.ai.testFailed"), description: result.error, variant: "destructive" },
      );
    } catch (err) {
      toast({
        title: t("settings.ai.testFailed"),
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    }
  };

  return (
    <Section embedded={embedded}>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3 rounded-md bg-surface-whisper px-3 py-2.5">
          <div className="min-w-0">
            <p className="text-body font-medium text-foreground">{t("settings.ai.enable")}</p>
            <p className="text-caption-quiet text-muted-foreground">
              {data.keySet
                ? t("settings.ai.enableHint", { provider: PROVIDERS.find((p) => p.value === data.provider)?.label ?? "" })
                : t("settings.ai.enableNeedsKey")}
            </p>
          </div>
          <Switch
            checked={data.enabled}
            disabled={!data.keySet || update.isPending}
            onCheckedChange={toggle}
            aria-label={t("settings.ai.enable")}
          />
        </div>

        {data.keyUnreadable && (
          <p className="rounded-md bg-warning-subtle px-3 py-2 text-caption text-warning-foreground">
            {t("settings.ai.keyUnreadable")}
          </p>
        )}

        <div className="space-y-1.5">
          <Label>{t("settings.ai.provider")}</Label>
          <RadioGroup
            value={chosen}
            onValueChange={(v) => setProvider(v as AiProvider)}
            className="flex flex-wrap gap-4"
          >
            {PROVIDERS.map((p) => (
              <label key={p.value} className="flex cursor-pointer items-center gap-2 text-body">
                <RadioGroupItem value={p.value} />
                {p.label}
              </label>
            ))}
          </RadioGroup>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="ai-api-key">{t("settings.ai.apiKey")}</Label>
            <Badge tone={keepsKey ? "success" : "neutral"} className="shrink-0">
              {keepsKey ? t("settings.slack.connected") : t("settings.slack.notSet")}
            </Badge>
          </div>
          <Input
            id="ai-api-key"
            dir="ltr"
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={keepsKey ? t("settings.slack.keepCurrent") : meta.placeholder}
            className="font-mono text-caption"
          />
          <p className="text-caption-quiet text-subtle">
            {t("settings.ai.apiKeyHint", { provider: meta.label })}{" "}
            <a href={meta.keysUrl} target="_blank" rel="noreferrer" className="text-brand underline-offset-2 hover:underline">
              {t("settings.ai.getKey", { provider: meta.label })}
            </a>
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ai-model">{t("settings.ai.model")}</Label>
          <Input
            id="ai-model"
            dir="ltr"
            value={modelValue}
            onChange={(e) => setModel(e.target.value)}
            placeholder={data.defaultModels[chosen]}
            className="font-mono text-caption"
          />
          <p className="text-caption-quiet text-subtle">
            {t("settings.ai.modelHint", { model: data.defaultModels[chosen] })}
          </p>
        </div>

        {!data.keySet && data.serverKeyAvailable && (
          <p className="text-caption-quiet text-muted-foreground">{t("settings.ai.serverKeyNote")}</p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" onClick={save} disabled={!canSave || update.isPending}>
            {update.isPending && <Loader2 className="me-1.5 h-4 w-4 animate-spin" />}
            {t("common.save")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void runTest()}
            disabled={!data.keySet || test.isPending}
          >
            {test.isPending && <Loader2 className="me-1.5 h-4 w-4 animate-spin" />}
            {t("settings.ai.test")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={disconnect}
            disabled={!data.keySet || update.isPending}
          >
            {t("settings.ai.disconnect")}
          </Button>
        </div>
      </div>
    </Section>
  );
}

function Section({ children, embedded }: { children: ReactNode; embedded: boolean }) {
  const { t } = useI18n();
  if (embedded) return <>{children}</>;
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="text-body font-semibold text-foreground">{t("settings.ai.title")}</h2>
      <p className="mb-4 text-caption-quiet text-muted-foreground">{t("settings.ai.description")}</p>
      {children}
    </section>
  );
}
