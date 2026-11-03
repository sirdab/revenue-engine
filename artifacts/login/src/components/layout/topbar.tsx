import React, { useState } from "react";
import { Search, LogOut, User as UserIcon, Menu, Sun, Moon } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
import { useI18n } from "@/lib/i18n/i18n";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Kbd } from "@sirdab/one/components/kbd";
import { NotificationBell } from "@/components/layout/notification-bell";
import { TOPBAR_ICON_BUTTON } from "@/components/layout/topbar-icon";
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
    // One's header: frosted (background at 90% over a blur) so content
    // dissolves beneath it; the rail beside it stays solid.
    <div className="h-[var(--shell-header-height)] bg-header-surface backdrop-blur-header border-b border-border flex items-center justify-between gap-3 px-4 md:px-6 flex-shrink-0">
      <div className="flex items-center gap-2 flex-1 min-w-0 max-w-xl">
        <button
          type="button"
          onClick={onOpenMobile}
          aria-label={t("topbar.openMenu")}
          className={cn(TOPBAR_ICON_BUTTON, "md:hidden")}
        >
          <Menu />
        </button>
        <button
          type="button"
          onClick={onOpenSearch}
          aria-label={t("topbar.search")}
          className="relative flex h-control-lg w-full min-w-0 max-w-[var(--shell-search-width)] flex-1 items-center gap-2 rounded-lg border border-btn-border bg-background ps-9 pe-2 text-start text-body-quiet text-subtle transition-colors hover:border-btn-border-hover hover:bg-btn-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 size-4 text-subtle" />
          <span className="flex-1 truncate">
            {t("topbar.searchPlaceholder")}
          </span>
          <Kbd className="hidden sm:inline-flex">⌘K</Kbd>
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <NotificationBell />
        <RecentChangesMenu />
        <LanguageToggle />
        <button
          type="button"
          onClick={toggle}
          aria-label={theme === "dark" ? t("topbar.switchToLight") : t("topbar.switchToDark")}
          title={theme === "dark" ? t("topbar.lightMode") : t("topbar.darkMode")}
          className={TOPBAR_ICON_BUTTON}
        >
          {theme === "dark" ? <Sun /> : <Moon />}
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger className="ms-1 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Avatar>
              <AvatarFallback>{user ? getInitials(user.name) : <UserIcon className="w-4 h-4" />}</AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="flex flex-col">
              <span className="font-medium">{user?.name}</span>
              <span className="text-caption text-muted-foreground font-normal">{user?.email}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <LanguageMenuSection />
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => logout()} className="cursor-pointer">
              <LogOut className="me-2 w-4 h-4" />
              {t("topbar.signOut")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

    </div>
  );
}
