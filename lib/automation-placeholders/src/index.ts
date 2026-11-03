// Single source of truth for automation message placeholders, shared by the
// server (validation + rendering in api-server) and the client (the wizard's
// field chips + live preview). Keeping it here stops the whitelist and the
// wizard's preview from drifting apart.

// Placeholder fields per scope. Templates use {{scope.field}} (e.g.
// {{deal.title}}, {{deal.stage}}); only whitelisted fields resolve —
// unknown placeholders render blank, so a template can never leak arbitrary
// columns.
export const TEMPLATE_FIELDS: Record<string, readonly string[]> = {
  deal: [
    "id",
    "title",
    "value",
    "currency",
    "status",
    "stageId",
    "pipelineId",
    // Friendly names, resolved by the engine before rendering:
    "owner",
    "stage",
    "pipeline",
    "organization",
  ],
  // The SUBSCRIBER's own tuning of a notification rule, so a shared rule can
  // say "…in {{params.days}} days" and each subscriber reads their own number.
  // Resolved per recipient, which is why it only applies to the
  // post_notification action — a Slack channel post has no single subscriber to
  // resolve it against.
  params: ["days"],
};

/**
 * True when `insert` is a {{scope.field}} placeholder allowed by the whitelist
 * above (used to validate custom chip config). Plain snippets (no braces) are
 * always fine.
 */
export function isAllowedTemplateToken(insert: string): boolean {
  const m = /^\{\{\s*(\w+)\.(\w+)\s*\}\}$/.exec(insert);
  if (!m) return !insert.includes("{{"); // snippet: no placeholder syntax
  return TEMPLATE_FIELDS[m[1]]?.includes(m[2]) ?? false;
}

/** One clickable field button in the wizard's message editor. Matches the
 *  MessageChip API shape structurally. */
export interface MessageChipDefault {
  insert: string;
  label: string;
  labelAr?: string;
}

// Default field chips shown until an org customizes them. The server serves
// these as the defaults for the "Customize fields" setting; the wizard falls
// back to them while that config loads.
export const DEFAULT_MESSAGE_CHIPS: {
  deal: MessageChipDefault[];
} = {
  deal: [
    { insert: "{{deal.title}}", label: "Deal name", labelAr: "اسم الصفقة" },
    { insert: "{{deal.value}}", label: "Value", labelAr: "القيمة" },
    { insert: "{{deal.currency}}", label: "Currency", labelAr: "العملة" },
    { insert: "{{deal.status}}", label: "Status", labelAr: "الحالة" },
    { insert: "{{deal.owner}}", label: "Deal owner", labelAr: "مالك الصفقة" },
    { insert: "{{deal.stage}}", label: "Stage", labelAr: "المرحلة" },
    { insert: "{{deal.pipeline}}", label: "Pipeline", labelAr: "خط المبيعات" },
    { insert: "{{deal.organization}}", label: "Organization", labelAr: "الشركة" },
  ],
};
