import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useI18n, type MessageKey } from "@/lib/i18n/i18n";

// The Settings sidebar + content pane, shared by the admin sections and the
// per-user Notifications page.
//
// WHY IT IS SHARED. /admin/settings/:section is wrapped in <AuthGuard adminOnly>
// as a whole, so a per-user page cannot live inside it without locking non-admins
// out of their own settings. The first attempt therefore put Notifications in the
// sidebar as a link OUT to /settings/notifications — which worked, except the
// sidebar vanished the moment you clicked it, because that page had no shell.
// Lifting the shell here lets the sidebar stay put across both routes while the
// notifications route stays open to everyone.
//
// A non-admin sees only the sections they can actually open. Rendering the full
// list for them would be a menu of dead ends: every other entry lands on the
// adminOnly guard.

export interface SettingsSection {
  slug: string;
  /** A message key, not a label: this table is module-level, so the word is
   *  resolved at render through t() rather than frozen at import time. */
  labelKey: MessageKey;
  /** Sections below the divider (admin/data config, distinct from workspace prefs). */
  belowDivider?: boolean;
  /** An absolute route, for a section that is not under /admin/settings. */
  href?: string;
  /** Reachable by any signed-in user, not just admins. */
  everyone?: boolean;
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { slug: "workspace", labelKey: "settings.nav.workspace" },
  { slug: "pipelines", labelKey: "settings.nav.pipelines" },
  { slug: "teams", labelKey: "settings.teams.title" },
  { slug: "assignment-rules", labelKey: "settings.nav.assignmentRules" },
  {
    slug: "notifications",
    labelKey: "notifications.title",
    href: "/settings/notifications",
    everyone: true,
  },
  { slug: "automations", labelKey: "settings.nav.automations" },
  { slug: "labels", labelKey: "settings.nav.labels" },
  { slug: "imports", labelKey: "settings.nav.imports" },
  { slug: "custom-fields", labelKey: "settings.nav.customFields", belowDivider: true },
  { slug: "integrations", labelKey: "settings.nav.integrations" },
];

export function SettingsShell({
  active,
  children,
}: {
  active: string;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  const { user } = useAuth();
  const sections = user?.isAdmin
    ? SETTINGS_SECTIONS
    : SETTINGS_SECTIONS.filter((s) => s.everyone);

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      {/* Section nav: horizontal scrollable bar on phones, sidebar on md+. */}
      <nav className="shrink-0 border-b border-slate-200 bg-slate-50/50 p-2 md:w-56 md:overflow-y-auto md:border-b-0 md:border-e md:p-3">
        <p className="mb-2 hidden px-2 text-xs font-semibold uppercase tracking-wider text-slate-400 md:block">
          {t("common.settings")}
        </p>
        <div className="flex gap-1 overflow-x-auto md:flex-col md:gap-0.5 md:overflow-visible">
          {sections.map((s) => (
            <div key={s.slug} className="shrink-0 md:shrink">
              {s.belowDivider && (
                <div className="my-2 hidden border-t border-slate-200 md:block" />
              )}
              <Link
                href={s.href ?? `/admin/settings/${s.slug}`}
                className={cn(
                  "block whitespace-nowrap rounded-md px-3 py-2 text-sm transition-colors",
                  active === s.slug
                    ? "bg-card font-medium text-teal-700 shadow-sm"
                    : "text-slate-600 hover:bg-card hover:text-slate-900",
                )}
              >
                {t(s.labelKey)}
              </Link>
            </div>
          ))}
        </div>
      </nav>

      <div className="min-w-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
