import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/i18n";
import {
  useSlackSettings,
  useUpdateSlackSettings,
  type SlackSettingsUpdate,
} from "@/lib/webhook-settings-api";

// Settings › Integrations › Slack: the workspace's own Slack connection. A bot
// token posts to any channel and DMs people; the legacy incoming webhook posts
// to its one fixed channel and is used only when there is no bot token. The
// secrets are write-only, so their inputs start empty and a blank input on
// Save leaves the stored value alone.

function StatusPill({ set }: { set: boolean }) {
  const { t } = useI18n();
  return (
    <span
      className={cn(
        "shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        set
          ? "border-teal-200 bg-teal-50 text-teal-700"
          : "border-slate-200 bg-slate-50 text-slate-500",
      )}
    >
      {set ? t("settings.slack.connected") : t("settings.slack.notSet")}
    </span>
  );
}

export function SlackSettings() {
  const { t } = useI18n();
  const { toast } = useToast();
  const { data, isLoading, isError } = useSlackSettings();
  const update = useUpdateSlackSettings();
  const [botToken, setBotToken] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  // null = untouched, so the field shows the stored channel until edited.
  const [channel, setChannel] = useState<string | null>(null);
  const channelValue = channel ?? data?.announceChannel ?? "";

  const send = async (body: SlackSettingsUpdate, done: string) => {
    try {
      await update.mutateAsync(body);
      setBotToken("");
      setWebhookUrl("");
      setChannel(null);
      toast({ title: done });
    } catch (err) {
      toast({
        title: t("settings.slack.saveFailed"),
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    }
  };

  const save = () =>
    void send(
      {
        ...(botToken.trim() ? { botToken: botToken.trim() } : {}),
        ...(webhookUrl.trim() ? { webhookUrl: webhookUrl.trim() } : {}),
        ...(channel !== null ? { announceChannel: channel.trim() || null } : {}),
      },
      t("settings.slack.saved"),
    );

  const clear = () => {
    if (!window.confirm(t("settings.slack.clearConfirm"))) return;
    void send(
      { botToken: null, webhookUrl: null, announceChannel: null },
      t("settings.slack.cleared"),
    );
  };

  const dirty = Boolean(botToken.trim() || webhookUrl.trim() || channel !== null);
  const anythingSet = Boolean(data && (data.botTokenSet || data.webhookUrlSet || data.announceChannel));

  return (
    <section className="rounded-lg border border-slate-200 bg-card p-4">
      <h2 className="text-sm font-semibold text-slate-900">{t("settings.slack.title")}</h2>
      <p className="mb-4 text-xs text-slate-500">{t("settings.slack.description")}</p>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}
        </div>
      ) : isError || !data ? (
        <p className="text-sm text-red-600">{t("settings.slack.loadFailed")}</p>
      ) : (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="slack-bot-token">{t("settings.slack.botToken")}</Label>
              <StatusPill set={data.botTokenSet} />
            </div>
            <Input
              id="slack-bot-token"
              type="password"
              autoComplete="off"
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
              placeholder={data.botTokenSet ? t("settings.slack.keepCurrent") : "xoxb-…"}
              className="font-mono text-xs"
            />
            <p className="text-xs text-slate-400">{t("settings.slack.botTokenHint")}</p>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="slack-webhook-url">{t("settings.slack.webhookUrl")}</Label>
              <StatusPill set={data.webhookUrlSet} />
            </div>
            <Input
              id="slack-webhook-url"
              type="password"
              autoComplete="off"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder={
                data.webhookUrlSet
                  ? t("settings.slack.keepCurrent")
                  : "https://hooks.slack.com/services/…"
              }
              className="font-mono text-xs"
            />
            <p className="text-xs text-slate-400">{t("settings.slack.webhookUrlHint")}</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="slack-channel">{t("settings.slack.announceChannel")}</Label>
            <Input
              id="slack-channel"
              value={channelValue}
              onChange={(e) => setChannel(e.target.value)}
              placeholder="#sales"
            />
            <p className="text-xs text-slate-400">{t("settings.slack.announceChannelHint")}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={save}
              disabled={!dirty || update.isPending}
              className="bg-teal-600 text-white hover:bg-teal-700"
            >
              {update.isPending && <Loader2 className="me-1.5 h-4 w-4 animate-spin" />}
              {t("common.save")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={clear}
              disabled={!anythingSet || update.isPending}
            >
              {t("settings.slack.clear")}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
