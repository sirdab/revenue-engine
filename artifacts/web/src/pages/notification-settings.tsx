import { NotificationPreferencesSettings } from "@/components/settings/notification-preferences-settings";
import { SettingsShell } from "@/components/settings/settings-shell";

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
  return (
    // Inside the shared Settings shell so the sidebar stays put — clicking
    // Notifications used to navigate away from it and the whole nav vanished.
    <SettingsShell active="notifications">
      <div className="mx-auto w-full max-w-3xl px-4 py-4">
      <div className="px-5 pt-5 pb-5">
        <h1 className="text-heading-sm text-foreground">
          My notifications
        </h1>
        <p className="mt-1 text-body-quiet text-muted-foreground">
          Choose what you want to be told about. These settings are yours alone.
        </p>
      </div>
        <NotificationPreferencesSettings />
      </div>
    </SettingsShell>
  );
}
