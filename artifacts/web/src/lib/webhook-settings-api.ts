import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

// Admin API for Settings › Integrations: the inbound-webhook shared secret and
// the Slack connection. Hand-written fetch (same pattern as deal-fields-api) — not part of the
// generated OpenAPI client.

interface WebhookSecret {
  secret: string;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json() as Promise<T>;
}

const KEY = ["webhook-secret"];

export function useWebhookSecret() {
  return useQuery({
    queryKey: KEY,
    queryFn: async () => {
      const res = await fetch("/api/settings/webhook-secret", {
        headers: { accept: "application/json" },
        credentials: "same-origin",
      });
      return json<WebhookSecret>(res);
    },
    staleTime: 60_000,
  });
}

export function useRotateWebhookSecret() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/settings/webhook-secret/rotate", {
        method: "POST",
        headers: { accept: "application/json" },
        credentials: "same-origin",
      });
      return json<WebhookSecret>(res);
    },
    onSuccess: (data) => {
      queryClient.setQueryData(KEY, data);
    },
  });
}

// The workspace's Slack connection, used for team notifications and the
// automations "Send Slack message" action. Secrets are write-only: the server
// only ever says whether each one is set.

export interface SlackSettings {
  botTokenSet: boolean;
  webhookUrlSet: boolean;
  announceChannel: string | null;
}

/** Omit a field to leave it unchanged; null (or "") clears it. */
export interface SlackSettingsUpdate {
  botToken?: string | null;
  webhookUrl?: string | null;
  announceChannel?: string | null;
}

const SLACK_KEY = ["slack-settings"];

export function useSlackSettings() {
  return useQuery({
    queryKey: SLACK_KEY,
    queryFn: async () => {
      const res = await fetch("/api/settings/slack", {
        headers: { accept: "application/json" },
        credentials: "same-origin",
      });
      return json<SlackSettings>(res);
    },
    staleTime: 60_000,
  });
}

export function useUpdateSlackSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: SlackSettingsUpdate) => {
      const res = await fetch("/api/settings/slack", {
        method: "PUT",
        headers: { accept: "application/json", "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        // A 400 names what is wrong (a token that isn't xoxb-, a webhook URL
        // that isn't Slack's), so the card can say it.
        const data = (await res.json().catch(() => null)) as { error?: unknown } | null;
        throw new Error(
          typeof data?.error === "string" ? data.error : `Request failed (${res.status})`,
        );
      }
      return res.json() as Promise<SlackSettings>;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(SLACK_KEY, data);
    },
  });
}
