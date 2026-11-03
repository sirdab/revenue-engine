import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

// Admin API for the inbound-webhook shared secret (Settings › Integrations).
// Hand-written fetch (same pattern as deal-fields-api) — not part of the
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
