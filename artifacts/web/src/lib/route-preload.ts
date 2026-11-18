import type { ComponentType } from "react";

// Route-level code-split chunks, keyed by nav path. App.tsx lazy-loads pages
// from these, and the sidebar warms them on hover/focus so the chunk is
// usually already downloaded by the time the user clicks.
export const routeLoaders = {
  "/home": () => import("@/pages/home"),
  "/insights": () => import("@/pages/insights"),
  "/deals": () => import("@/pages/deals"),
  "/contacts": () => import("@/pages/contacts"),
  "/activities": () => import("@/pages/activities"),
  "/import": () => import("@/pages/admin-import"),
  "/admin/users": () => import("@/pages/admin-users"),
  "/admin/settings": () => import("@/pages/admin-settings"),
  // Personal, not admin — see pages/notification-settings.tsx.
  "/settings/notifications": () => import("@/pages/notification-settings"),
  "/ask-ai": () => import("@/pages/ask-ai"),
} satisfies Record<string, () => Promise<{ default: ComponentType }>>;

export function preloadRoute(path: string): void {
  void routeLoaders[path as keyof typeof routeLoaders]?.();
}
