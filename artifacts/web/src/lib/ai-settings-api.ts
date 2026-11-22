import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

// The workspace's AI connection (Settings › Integrations › AI assistant) and
// whether Ask AI is available. Hand-written fetch, like webhook-settings-api:
// these routes are not part of the generated OpenAPI client.

export type AiProvider = "openai" | "anthropic";

export interface AiSettings {
  provider: AiProvider | null;
  keySet: boolean;
  /** A key is stored but the server can no longer decrypt it. */
  keyUnreadable: boolean;
  model: string | null;
  enabled: boolean;
  defaultModels: Record<AiProvider, string>;
  /** The server has its own key, used while this workspace has none. */
  serverKeyAvailable: boolean;
}

/** Omit a field to leave it unchanged. apiKey null clears the key. */
export interface AiSettingsUpdate {
  provider?: AiProvider;
  apiKey?: string | null;
  model?: string | null;
  enabled?: boolean;
}

export interface AssistantStatus {
  available: boolean;
  provider: AiProvider | null;
}

const SETTINGS_KEY = ["ai-settings"];
const STATUS_KEY = ["assistant-status"];

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    // A 400 names what is wrong (a rejected key, a key for the other
    // provider), so the card can say it.
    const data = (await res.json().catch(() => null)) as { error?: unknown } | null;
    throw new Error(typeof data?.error === "string" ? data.error : `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export function useAiSettings() {
  return useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: async () =>
      json<AiSettings>(
        await fetch("/api/settings/ai", {
          headers: { accept: "application/json" },
          credentials: "same-origin",
        }),
      ),
    staleTime: 60_000,
  });
}

export function useUpdateAiSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: AiSettingsUpdate) =>
      json<AiSettings>(
        await fetch("/api/settings/ai", {
          method: "PUT",
          headers: { accept: "application/json", "content-type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify(body),
        }),
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(SETTINGS_KEY, data);
      void queryClient.invalidateQueries({ queryKey: STATUS_KEY });
    },
  });
}

export function useTestAiConnection() {
  return useMutation({
    mutationFn: async () =>
      json<{ ok: true } | { ok: false; error: string }>(
        await fetch("/api/settings/ai/test", {
          method: "POST",
          headers: { accept: "application/json" },
          credentials: "same-origin",
        }),
      ),
  });
}

export function useAssistantStatus() {
  return useQuery({
    queryKey: STATUS_KEY,
    queryFn: async () =>
      json<AssistantStatus>(
        await fetch("/api/assistant/status", {
          headers: { accept: "application/json" },
          credentials: "same-origin",
        }),
      ),
    staleTime: 60_000,
  });
}
