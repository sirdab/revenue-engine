import React, { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Sidebar, MobileSidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { GlobalSearch } from "@/components/search/global-search";
import { useIsMobile } from "@/hooks/use-mobile";
import { usePreference } from "@/hooks/use-user-preferences";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = usePreference(
    "layout.sidebarCollapsed",
    false,
  );
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const isMobile = useIsMobile();
  const [location] = useLocation();
  const mainRef = useRef<HTMLElement>(null);

  // Never leave the drawer mounted-open when growing back to desktop width.
  useEffect(() => {
    if (!isMobile) setMobileOpen(false);
  }, [isMobile]);

  // The layout persists across navigation, so reset the content scroll
  // position when the route changes.
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [location]);

  // Global shortcuts: Cmd/Ctrl+K search, Cmd/Ctrl+B sidebar.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key === "k") {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      } else if (key === "b") {
        e.preventDefault();
        setCollapsed((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const toggleSidebar = () => setCollapsed((prev) => !prev);

  return (
    <div className="flex h-[100dvh] bg-background overflow-hidden w-full text-foreground">
      <Sidebar collapsed={collapsed} onToggle={toggleSidebar} />
      <MobileSidebar open={mobileOpen} onOpenChange={setMobileOpen} />
      <div className="flex flex-col flex-1 min-w-0">
        <Topbar
          onOpenMobile={() => setMobileOpen(true)}
          onOpenSearch={() => setSearchOpen(true)}
        />
        <main ref={mainRef} className="flex-1 overflow-auto bg-background">
          {children}
        </main>
      </div>
      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}
