import React, { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import { BrandMark } from "@/components/layout/brand-mark";
import { useI18n } from "@/lib/i18n/i18n";

// adminOnly only decides what to RENDER; the API gates itself.
export function AuthGuard({
  children,
  adminOnly = false,
}: {
  children: React.ReactNode;
  adminOnly?: boolean;
}) {
  const { t } = useI18n();
  const { user, isLoading: authLoading } = useAuth();
  // Deliberately NOT gating on useUserPreferences() here anymore: if that
  // fetch is ever slow, erroring, or hung, it must not block every logged-in
  // user from ever seeing the app. usePreference() already falls back to
  // each call site's defaultValue while preferences are loading, so routes
  // mount fine and just snap to saved values a moment later.
  const isLoading = authLoading;
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!authLoading && !user) {
      // Not "/": that is the public landing page, and the server sends anyone
      // holding a session cookie (even a stale one) from there back to /home.
      setLocation("/login");
    } else if (!isLoading && user && adminOnly && !user.isAdmin) {
      setLocation("/home");
    }
  }, [user, authLoading, isLoading, setLocation, adminOnly]);

  if (isLoading) {
    return (
      <div className="flex h-[100dvh] w-full flex-col items-center justify-center gap-3 bg-surface-whisper">
        <BrandMark iconOnly className="animate-pulse" />
        <span className="text-caption text-subtle">{t("auth.loadingWorkspace")}</span>
      </div>
    );
  }

  if (!user || (adminOnly && !user.isAdmin)) return null;

  return <>{children}</>;
}
