import type { ReactNode } from "react";
import { usePreference } from "@/hooks/use-user-preferences";
import { Switch } from "@/components/ui/switch";
import { SectionCard } from "@/components/settings/section-card";
import { useI18n, type MessageKey } from "@/lib/i18n/i18n";

// Settings → Notifications: per-category, per-channel on/off
// (including an option to disable email notifications).
//
// The per-rule subscription list that used to sit above this is GONE, and so is
// the single "Automations" switch that replaced it. That list was this feature's
// worst design decision: authoring a rule in Settings → Automations looked like
// finishing, while a second identical-looking toggle on this page was what
// actually made it deliver, with nothing on the first page saying so. Someone
// lost a week to it. Automation alerts are now simply on for everyone, so the
// row below is a statement of fact rather than a switch.
//
// Stored at notifications.<category>.{email,inApp}, deep-merged into the same
// preferences document as everything else on this page. A key that was never
// written (every existing user, on ship day) or a corrupted value both read
// as "on" server-side — see channelPrefsFor in api-server's notifications.ts
// — so defaulting every toggle here to `true` mirrors that exactly.
//
// LAYOUT: every switch sits in a fixed-width cell so the Email and In-app
// columns line up down the card. A channel that cannot be changed renders the
// same switch, disabled — dimmed by the Switch's own disabled:opacity-50 — with
// no trailing "Always on"/"n/a" text, because that text is what knocked the
// columns out of alignment and the dimming already says it.

type Category = "reminder" | "overdue" | "assignment" | "mention";

interface CategoryPrefs {
  email?: boolean;
  inApp?: boolean;
}

// Message keys, not labels: this table is module-level, so the words are
// resolved at render. "@Mentions" is a literal on purpose — the
// @ is the thing people recognise and it is not a word to translate.
const CATEGORIES: {
  id: Category;
  labelKey: MessageKey;
  descriptionKey: MessageKey;
}[] = [
  {
    id: "reminder",
    labelKey: "settings.notifications.reminders",
    descriptionKey: "settings.notifications.remindersDescription",
  },
  {
    id: "overdue",
    labelKey: "settings.notifications.overdue",
    descriptionKey: "settings.notifications.overdueDescription",
  },
  {
    id: "assignment",
    labelKey: "settings.notifications.assignments",
    descriptionKey: "settings.notifications.assignmentsDescription",
  },
  {
    id: "mention",
    labelKey: "settings.notifications.mentions",
    descriptionKey: "settings.notifications.mentionsDescription",
  },
];

/** One fixed-width channel cell, so the switches align column-wise. */
function Channel({
  label,
  checked,
  disabled,
  title,
  ariaLabel,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  title?: string;
  ariaLabel: string;
  onCheckedChange?: (checked: boolean) => void;
}) {
  return (
    <label
      className="flex w-[86px] items-center justify-end gap-2"
      title={title}
    >
      <span className="text-xs text-slate-500">{label}</span>
      <Switch
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
        aria-label={ariaLabel}
      />
    </label>
  );
}

function Row({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-900">{label}</p>
        <p className="text-xs text-slate-500">{description}</p>
      </div>
      <div className="flex items-center gap-4">{children}</div>
    </div>
  );
}

function CategoryRow({
  category,
}: {
  category: (typeof CATEGORIES)[number];
}) {
  const { t } = useI18n();
  const [prefs, setPrefs] = usePreference<CategoryPrefs>(
    `notifications.${category.id}`,
    {},
  );
  const emailOn = prefs.email !== false;
  const inAppOn = prefs.inApp !== false;
  // The mentioned event's in-app row is inserted directly by lib/mentions.ts,
  // not by notify() — so the in-app toggle for "mention" has no effect on
  // anything (see plannedChannelsFor in the backend). Showing a live switch
  // here would be dishonest, so it's disabled with an explanation instead of
  // silently doing nothing.
  const inAppEditable = category.id !== "mention";

  return (
    <Row
      label={t(category.labelKey)}
      description={t(category.descriptionKey)}
    >
      <Channel
        label={t("common.email")}
        checked={emailOn}
        ariaLabel={t("settings.notifications.emailAria", {
          category: t(category.labelKey),
        })}
        onCheckedChange={(checked) =>
          setPrefs((prev) => ({ ...prev, email: checked }))
        }
      />
      <Channel
        label={t("settings.notifications.inApp")}
        checked={inAppEditable ? inAppOn : true}
        disabled={!inAppEditable}
        title={inAppEditable ? undefined : t("settings.notifications.alwaysOn")}
        ariaLabel={
          inAppEditable
            ? t("settings.notifications.inAppAria", {
                category: t(category.labelKey),
              })
            : t("settings.notifications.alwaysOnMentions")
        }
        onCheckedChange={
          inAppEditable
            ? (checked) => setPrefs((prev) => ({ ...prev, inApp: checked }))
            : undefined
        }
      />
    </Row>
  );
}

export function NotificationPreferencesSettings() {
  const { t } = useI18n();
  return (
    <div className="p-5 pt-0">
      <SectionCard
        title={t("settings.notifications.channels")}
        description={t("settings.notifications.channelsDescription")}
      >
        <div>
          {CATEGORIES.map((category) => (
            <CategoryRow key={category.id} category={category} />
          ))}
          {/* Automations: in-app for everyone, no email, nothing to set. An
              admin switching an automation on in Settings → Automations is the
              whole opt-in — a second switch here is what confused people. */}
          <Row
            label={t("settings.nav.automations")}
            description={t("settings.notifications.automationsDescription")}
          >
            <Channel
              label={t("common.email")}
              checked={false}
              disabled
              title={t("settings.notifications.automationsNoEmail")}
              ariaLabel={t("settings.notifications.automationsNoEmailAria")}
            />
            <Channel
              label={t("settings.notifications.inApp")}
              checked
              disabled
              title={t("settings.notifications.alwaysOn")}
              ariaLabel={t("settings.notifications.alwaysOnAutomations")}
            />
          </Row>
        </div>
      </SectionCard>
    </div>
  );
}
