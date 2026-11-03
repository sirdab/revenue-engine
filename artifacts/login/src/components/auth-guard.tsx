import React, { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import logoMark from "@/assets/brand/sirdab-favicon.png";
import { useI18n } from "@/lib/i18n/i18n";

// `allow` is a general predicate for routes whose audience is neither
// "everyone signed in" nor "admins" — WhatsApp is the first, gated
// on team membership. It is a predicate rather than another boolean prop so the
// next such route adds no new flag here. Like adminOnly it only decides what to
// RENDER; the API gates itself.
export function AuthGuard({
  children,
  adminOnly = false,
  allow,
}: {
  children: React.ReactNode;
  adminOnly?: boolean;
  allow?: (user: NonNullable<ReturnType<typeof useAuth>["user"]>) => boolean;
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
      setLocation("/");
    } else if (!isLoading && user && adminOnly && !user.isAdmin) {
      setLocation("/home");
    } else if (!isLoading && user && allow && !allow(user)) {
      setLocation("/home");
    }
  }, [user, authLoading, isLoading, setLocation, adminOnly, allow]);

  if (isLoading) {
    return (
      <div className="flex h-[100dvh] w-full flex-col items-center justify-center gap-3 bg-surface-whisper">
        <img src={logoMark} alt="Sirdab" className="h-10 w-10 animate-pulse object-contain" />
        <span className="text-xs text-subtle">{t("auth.loadingWorkspace")}</span>
      </div>
    );
  }

  if (!user || (adminOnly && !user.isAdmin)) return null;
  if (allow && !allow(user)) return null;

  return <>{children}</>;
}
