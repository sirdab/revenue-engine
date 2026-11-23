// The hosted plan's free trial: each workspace is free for
// HOSTED_TRIAL_MONTHS calendar months from its sign-up. Unset (the default,
// and what every self-hosted install wants) means no trial and no banner.
// The trial only drives a reminder for admins; nothing is ever locked.

/** Trial length in months, or null when this deployment has no trial. */
export function hostedTrialMonths(): number | null {
  const raw = process.env.HOSTED_TRIAL_MONTHS?.trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 36 ? n : null;
}

/** Where admins are sent to subscribe (BILLING_CONTACT_EMAIL), if anywhere. */
export function billingContactEmail(): string | null {
  const v = process.env.BILLING_CONTACT_EMAIL?.trim();
  return v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null;
}

/**
 * `months` calendar months after `from`, in UTC. A day the target month
 * doesn't have lands on its last day (30 Nov + 3 months is 28 or 29 Feb),
 * never spilling into the month after.
 */
export function addMonthsUtc(from: Date, months: number): Date {
  const y = from.getUTCFullYear();
  const m = from.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const d = new Date(from);
  d.setUTCFullYear(y, m, Math.min(from.getUTCDate(), lastDay));
  return d;
}

export interface WorkspaceTrial {
  endsAt: string;
  contactEmail: string | null;
}

/** The workspace's trial, or null when this deployment has none. */
export function workspaceTrial(createdAt: Date): WorkspaceTrial | null {
  const months = hostedTrialMonths();
  if (months == null) return null;
  return {
    endsAt: addMonthsUtc(createdAt, months).toISOString(),
    contactEmail: billingContactEmail(),
  };
}
