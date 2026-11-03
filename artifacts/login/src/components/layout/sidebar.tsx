import React from "react";
import { Link, useLocation } from "wouter";
import {
  Home,
  BarChart3,
  LayoutDashboard,
  Users,
  CalendarDays,
  Settings,
  PanelLeftClose,
  PanelLeft,
  SlidersHorizontal,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useI18n, type MessageKey } from "@/lib/i18n/i18n";
import { cn } from "@/lib/utils";
import { preloadRoute } from "@/lib/route-preload";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import logo from "@/assets/brand/sirdab-logo.webp";
import logoMark from "@/assets/brand/sirdab-favicon.png";

type NavItem = {
  /** A message key, not a label: the rail is translated, so the name is
   *  resolved per render rather than frozen into this table. */
  name: MessageKey;
  path: string;
  icon: typeof LayoutDashboard;
  /** Extra path prefixes that light this item up (e.g. detail pages). */
  match?: string[];
  /** Pre-release features wear a small "beta" chip next to the label. */
  beta?: boolean;
};

const navItems: NavItem[] = [
  { name: "nav.home", path: "/home", icon: Home },
  { name: "nav.insights", path: "/insights", icon: BarChart3 },
  { name: "nav.deals", path: "/deals", icon: LayoutDashboard, match: ["/deal/"] },
  { name: "nav.contacts", path: "/contacts", icon: Users, match: ["/organization/"] },
  { name: "nav.activities", path: "/activities", icon: CalendarDays },
];

const adminItems: NavItem[] = [
  { name: "nav.users", path: "/admin/users", icon: Settings },
  { name: "nav.settings", path: "/admin/settings", icon: SlidersHorizontal },
  // Import lives inside Settings → Imports now, so it no longer needs its own
  // top-level entry. The /import route still resolves (bookmarks, links from
  // elsewhere) — it just isn't advertised twice.
];

// Section heading with constant geometry in both sidebar states: the text and
// the divider crossfade in place, so items below never jump vertically while
// the rail width animates.
function SectionLabel({
  collapsed,
  first = false,
  children,
}: {
  collapsed: boolean;
  first?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("relative mb-2 h-4 shrink-0", first ? "mt-0" : "mt-6")}>
      <div
        className={cn(
          "absolute inset-x-2 top-1/2 border-t border-slate-200 transition-opacity duration-300",
          collapsed ? "opacity-100" : "opacity-0",
        )}
      />
      <div
        className={cn(
          "overflow-hidden whitespace-nowrap px-3 text-xs font-semibold uppercase tracking-wider text-slate-400 transition-opacity duration-300",
          collapsed ? "opacity-0" : "opacity-100",
        )}
      >
        {children}
      </div>
    </div>
  );
}

function NavSection({
  collapsed,
  onNavigate,
}: {
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const [location] = useLocation();
  const { user } = useAuth();
  const { t, dir } = useI18n();
  // The rail sits on the start edge, so its tooltips open towards the
  // content — which is the other side entirely once the page is RTL.
  const tooltipSide = dir === "rtl" ? "left" : "right";

  const renderItem = (item: NavItem) => {
    const active = [item.path, ...(item.match ?? [])].some((p) =>
      location.startsWith(p),
    );
    const Icon = item.icon;
    const label = t(item.name);
    const warm = () => preloadRoute(item.path);

    // Fixed geometry in both states: the icon never moves; only the label
    // fades/collapses. In the 64px rail (12px nav padding + 10px link padding
    // per side) the 20px icon sits dead-centre.
    const link = (
      <Link
        href={item.path}
        aria-label={label}
        onClick={onNavigate}
        onMouseEnter={warm}
        onFocus={warm}
        className={cn(
          "flex items-center rounded-md px-2.5 py-2.5 transition-colors",
          active
            // Light mode: the original subtle teal pill. Dark mode: the
            // .dark .nav-active override (index.css) turns it solid teal.
            ? "nav-active bg-teal-50 text-teal-700 font-medium"
            : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
        )}
      >
        <Icon
          className={cn(
            "w-5 h-5 flex-shrink-0",
            active ? "text-teal-600" : "text-slate-400",
          )}
        />
        <span
          aria-hidden={collapsed}
          className={cn(
            "overflow-hidden whitespace-nowrap transition-all duration-300",
            collapsed ? "ms-0 max-w-0 opacity-0" : "ms-3 max-w-40 opacity-100",
          )}
        >
          {label}
          {item.beta && (
            <span className="ms-2 rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold lowercase tracking-wide text-violet-700">
              {t("nav.beta")}
            </span>
          )}
        </span>
      </Link>
    );

    if (collapsed) {
      return (
        <Tooltip key={item.path} delayDuration={0}>
          <TooltipTrigger asChild>{link}</TooltipTrigger>
          <TooltipContent side={tooltipSide}>
            {label}
            {item.beta ? t("nav.betaSuffix") : ""}
          </TooltipContent>
        </Tooltip>
      );
    }

    return <React.Fragment key={item.path}>{link}</React.Fragment>;
  };

  return (
    <div className="flex-1 py-6 flex flex-col gap-1 px-3 overflow-y-auto overflow-x-hidden">
      <SectionLabel collapsed={collapsed} first>
        {t("nav.section.menu")}
      </SectionLabel>
      {navItems.map(renderItem)}


      {user?.isAdmin && (
        <>
          <SectionLabel collapsed={collapsed}>{t("nav.section.administration")}</SectionLabel>
          {adminItems.map(renderItem)}
        </>
      )}
    </div>
  );
}

function LogoHeader({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle?: () => void;
}) {
  const { t, dir } = useI18n();
  const tooltipSide = dir === "rtl" ? "left" : "right";
  return (
    <div
      className={cn(
        "h-16 flex items-center border-b border-slate-200 flex-shrink-0",
        collapsed ? "justify-center px-0" : "pe-3",
      )}
    >
      {collapsed ? (
        onToggle ? (
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onToggle}
                aria-label={t("nav.expandSidebar")}
                className="flex items-center justify-center rounded-md p-2 text-slate-500 hover:bg-slate-50 hover:text-slate-900 transition-colors"
              >
                <PanelLeft className="w-5 h-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side={tooltipSide}>{t("nav.expandSidebarHint")}</TooltipContent>
          </Tooltip>
        ) : (
          <img src={logoMark} alt="Sirdab" className="h-7 w-7 object-contain" />
        )
      ) : (
        <>
          {/* The wordmark is dark navy — invert+hue-rotate keeps the teal
              roughly teal while lifting the text to light. */}
          {/* Centered in the space left of the collapse button. */}
          <div className="flex flex-1 items-center justify-center">
            <img
              src={logo}
              alt="Sirdab Revenue Engine"
              className="h-8 w-auto dark:invert dark:hue-rotate-180"
            />
          </div>
          {onToggle && (
            <button
              type="button"
              onClick={onToggle}
              aria-label={t("nav.collapseSidebar")}
              title={t("nav.collapseSidebarHint")}
              className="flex items-center justify-center rounded-md p-2 text-slate-500 hover:bg-slate-50 hover:text-slate-900 transition-colors"
            >
              <PanelLeftClose className="w-5 h-5" />
            </button>
          )}
        </>
      )}
    </div>
  );
}

// Persistent rail — desktop/tablet only (md and up).
export function Sidebar({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className={cn(
        "bg-card border-e border-slate-200 hidden md:flex flex-col h-full flex-shrink-0 transition-[width] duration-300 ease-in-out",
        collapsed ? "w-16" : "w-64",
      )}
    >
      <LogoHeader collapsed={collapsed} onToggle={onToggle} />
      <NavSection collapsed={collapsed} />
    </div>
  );
}

// Slide-in drawer — mobile only (below md), opened from the topbar hamburger.
export function MobileSidebar({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        // The start edge, whichever side of the screen that is: it must
        // match the rail it stands in for, and the Sheet resolves the
        // direction itself.
        side="start"
        className="w-72 max-w-[85vw] p-0 flex flex-col bg-card [&>button]:hidden"
      >
        <SheetTitle className="sr-only">{t("nav.menuTitle")}</SheetTitle>
        <SheetDescription className="sr-only">
          {t("nav.menuDescription")}
        </SheetDescription>
        <LogoHeader collapsed={false} />
        <NavSection collapsed={false} onNavigate={() => onOpenChange(false)} />
      </SheetContent>
    </Sheet>
  );
}
