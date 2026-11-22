import { NotificationPreferencesSettings } from "@/components/settings/notification-preferences-settings";
import { SettingsShell } from "@/components/settings/settings-shell";
import { useI18n } from "@/lib/i18n/i18n";

// My notifications — a PERSONAL settings page, deliberately NOT a section of
// /admin/settings.
//
// /admin/settings/:section is wrapped in <AuthGuard adminOnly> as a whole, so a
// section added there is admin-only no matter how open its API is. The entire
// point of subscriptions is that a non-admin can switch their own notifications
// on without asking anyone, so this needs a route any authenticated user can
// reach. Admins land here too — they own deals like anyone else, and get an
// extra link across to the authoring panel.

export default function NotificationSettingsPage() {
  const { t } = useI18n();
  return (
    // Inside the shared Settings shell so the sidebar stays put — clicking
    // Notifications used to navigate away from it and the whole nav vanished.
    <SettingsShell active="notifications">
      {/* The same gutters and header as the other settings sections. */}
      <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6">
        <header className="mb-5">
          <h1 className="text-heading-sm text-foreground">
            {t("settings.notifications.pageTitle")}
          </h1>
          <p className="mt-1 text-body-quiet text-muted-foreground">
            {t("settings.notifications.pageSubtitle")}
          </p>
        </header>
        <NotificationPreferencesSettings />
      </div>
    </SettingsShell>
  );
}
