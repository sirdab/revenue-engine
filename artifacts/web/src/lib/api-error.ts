// Pull a human-readable message out of a failed API call. The generated client
// surfaces the server's JSON error body as `err.data.error`; fall back to the
// Error message, then a generic line.
export function errorMessage(err: unknown): string {
  if (err && typeof err === "object" && "data" in err) {
    const data = (err as { data?: { error?: unknown } }).data;
    if (data && typeof data.error === "string") return data.error;
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}
