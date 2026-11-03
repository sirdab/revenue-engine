import React, { useState } from "react";
import { Search, LogOut, User as UserIcon, Menu, Sun, Moon } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
import { useI18n } from "@/lib/i18n/i18n";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { NotificationBell } from "@/components/layout/notification-bell";
import { RecentChangesMenu } from "@/components/layout/recent-changes-menu";
import {
  LanguageMenuSection,
  LanguageToggle,
} from "@/components/layout/language-switcher";

export function Topbar({
  onOpenMobile,
  onOpenSearch,
}: {
  onOpenMobile: () => void;
  onOpenSearch: () => void;
}) {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const { t } = useI18n();

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .substring(0, 2);
  };

  return (
    <div className="h-16 bg-card border-b border-border flex items-center justify-between gap-3 px-4 md:px-6 flex-shrink-0">
      <div className="flex items-center gap-2 flex-1 min-w-0 max-w-xl">
        <button
          type="button"
          onClick={onOpenMobile}
          aria-label={t("topbar.openMenu")}
          className="md:hidden flex-shrink-0 rounded-md p-2 text-muted-foreground hover:bg-gray-alpha-100 hover:text-foreground transition-colors"
        >
          <Menu className="w-5 h-5" />
        </button>
        <button
          type="button"
          onClick={onOpenSearch}
          aria-label={t("topbar.search")}
          className="relative flex h-10 w-full min-w-0 max-w-md flex-1 items-center gap-2 rounded-md border border-border bg-surface-whisper ps-10 pe-2 text-start text-sm text-subtle transition-colors hover:border-input hover:bg-card focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-subtle" />
          <span className="flex-1 truncate">
            {t("topbar.searchPlaceholder")}
          </span>
          <kbd className="hidden shrink-0 items-center gap-0.5 rounded border border-border bg-card px-1.5 py-0.5 text-[10px] font-medium text-subtle sm:flex">
            ⌘K
          </kbd>
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-2 md:gap-3">
        <NotificationBell />
        <RecentChangesMenu />
        <LanguageToggle />
        <button
          type="button"
          onClick={toggle}
          aria-label={theme === "dark" ? t("topbar.switchToLight") : t("topbar.switchToDark")}
          title={theme === "dark" ? t("topbar.lightMode") : t("topbar.darkMode")}
          className="flex-shrink-0 rounded-md p-2 text-muted-foreground transition-colors hover:bg-gray-alpha-100 hover:text-foreground"
        >
          {theme === "dark" ? (
            <Sun className="h-5 w-5" />
          ) : (
            <Moon className="h-5 w-5" />
          )}
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger className="focus:outline-none">
            <Avatar size="lg" className="hover:ring-2 hover:ring-ring hover:ring-offset-2 transition-all">
              <AvatarFallback>{user ? getInitials(user.name) : <UserIcon className="w-4 h-4" />}</AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="flex flex-col">
              <span className="font-medium">{user?.name}</span>
              <span className="text-xs text-muted-foreground font-normal">{user?.email}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <LanguageMenuSection />
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => logout()} className="text-destructive cursor-pointer focus:text-destructive focus:bg-destructive-subtle">
              <LogOut className="me-2 w-4 h-4" />
              {t("topbar.signOut")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

    </div>
  );
}
