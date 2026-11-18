import { Suspense, useEffect, useState } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DirectionProvider } from "@sirdab/one/provider";
import { AuthProvider } from "@/hooks/use-auth";
import { I18nProvider, useI18n } from "@/lib/i18n/i18n";
import { AuthGuard } from "@/components/auth-guard";
import { AppLayout } from "@/components/layout/app-layout";
import { routeLoaders } from "@/lib/route-preload";
import { lazyWithReload } from "@/lib/chunk-reload";

// The login flow is the entry path — keep it in the main bundle.
import LoginPage from "@/pages/login";
import ForgotPasswordPage from "@/pages/forgot-password";
import ResetPasswordPage from "@/pages/reset-password";
import SignupPage from "@/pages/signup";

// Everything behind auth is code-split per route. Nav-reachable pages load
// through routeLoaders so the sidebar can prefetch them on hover.
const HomePage = lazyWithReload(routeLoaders["/home"]);
const InsightsPage = lazyWithReload(routeLoaders["/insights"]);
const DealsPage = lazyWithReload(routeLoaders["/deals"]);
const ContactsPage = lazyWithReload(routeLoaders["/contacts"]);
const ActivitiesPage = lazyWithReload(routeLoaders["/activities"]);
const AskAIPage = lazyWithReload(routeLoaders["/ask-ai"]);
const AdminImportPage = lazyWithReload(routeLoaders["/import"]);
const AdminUsersPage = lazyWithReload(routeLoaders["/admin/users"]);
const AdminSettingsPage = lazyWithReload(routeLoaders["/admin/settings"]);
const NotificationSettingsPage = lazyWithReload(
  routeLoaders["/settings/notifications"],
);
const DealDetailPage = lazyWithReload(() => import("@/pages/deal-detail"));
const OrganizationDetailPage = lazyWithReload(() => import("@/pages/organization-detail"));
const PersonDetailPage = lazyWithReload(() => import("@/pages/person-detail"));
const SearchPage = lazyWithReload(() => import("@/pages/search"));
const NotFound = lazyWithReload(() => import("@/pages/not-found"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Data is fresh for 30s: revisiting a page renders instantly from cache
      // (any refetch happens in the background) instead of unmounting into a
      // spinner. Mutations still refetch immediately via invalidateQueries.
      staleTime: 30_000,
      // Fail fast — one retry, not the default three with backoff. A 4xx is
      // the server's answer (a deleted deal, no permission), not a blip, so it
      // is never retried: that cost every not-found page a second of skeleton.
      // 408 and 429 are the two client errors that can succeed on a retry.
      retry: (failureCount, error) => {
        const status = (error as { status?: unknown } | null)?.status;
        if (
          typeof status === "number" &&
          status >= 400 &&
          status < 500 &&
          status !== 408 &&
          status !== 429
        ) {
          return false;
        }
        return failureCount < 1;
      },
    },
  },
});

// Pages that flow as a document (rather than owning the full viewport) get
// the standard content padding.
function Padded({ children }: { children: React.ReactNode }) {
  return <div className="p-4 md:p-6 lg:p-8">{children}</div>;
}

// Suspense fallback for lazy route chunks. Delayed so fast loads (warm cache,
// prefetched chunk) never flash a spinner.
function RouteFallback() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), 150);
    return () => clearTimeout(t);
  }, []);
  if (!show) return null;
  return (
    <div className="flex h-full items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-brand" />
    </div>
  );
}

function AppRoutes() {
  return (
    <Switch>
      <Route path="/home">
        <Padded>
          <HomePage />
        </Padded>
      </Route>
      <Route path="/insights" component={InsightsPage} />
      <Route path="/deals" component={DealsPage} />
      <Route path="/deal/:id" component={DealDetailPage} />
      <Route path="/organization/:id">
        <Padded>
          <OrganizationDetailPage />
        </Padded>
      </Route>
      <Route path="/person/:id">
        <Padded>
          <PersonDetailPage />
        </Padded>
      </Route>
      <Route path="/contacts" component={ContactsPage} />
      <Route path="/activities" component={ActivitiesPage} />
      <Route path="/ask-ai" component={AskAIPage} />
      <Route path="/search">
        <Padded>
          <SearchPage />
        </Padded>
      </Route>
      <Route path="/admin/users">
        <AuthGuard adminOnly>
          <AdminUsersPage />
        </AuthGuard>
      </Route>
      {/* Personal notification settings. NOT under /admin/settings, which is
          adminOnly as a whole — the point of these is that a non-admin can switch
          their own on. The outer <AuthGuard> still applies.
          Not <Padded>: the page renders the shared Settings shell, which is a
          full-height sidebar + pane like /admin/settings, and padding around it
          would inset the sidebar and break the flush edge. */}
      <Route path="/settings/notifications">
        <NotificationSettingsPage />
      </Route>
      <Route path="/admin/settings/:section?">
        <AuthGuard adminOnly>
          <AdminSettingsPage />
        </AuthGuard>
      </Route>
      <Route path="/import">
        <AuthGuard adminOnly>
          <Padded>
            <AdminImportPage />
          </Padded>
        </AuthGuard>
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={LoginPage} />
      <Route path="/signup" component={SignupPage} />
      <Route path="/forgot-password" component={ForgotPasswordPage} />
      <Route path="/reset-password" component={ResetPasswordPage} />
      {/* Single persistent shell: sidebar/topbar mount once and survive
          navigation — only the content inside <main> swaps. */}
      <Route>
        <AuthGuard>
          <AppLayout>
            <Suspense fallback={<RouteFallback />}>
              <AppRoutes />
            </Suspense>
          </AppLayout>
        </AuthGuard>
      </Route>
    </Switch>
  );
}

/**
 * The routed tree, remounted whenever the language changes.
 *
 * Messages come from context and re-render on their own; what does not is
 * anything computed once and kept — a `useMemo` of table columns, a
 * formatted date in state, a pure helper's cached answer. Rather than audit
 * every memo in 260 files for a `t` in its deps, the switch remounts the
 * tree. Nothing of value lives only in component state across a language
 * change: the route is in the URL, the sidebar in preferences, the data in
 * the query cache.
 */
function LocaleKeyedRouter() {
  const { locale, dir } = useI18n();
  // One's components read direction from Radix context (menus, popovers,
  // sheets); the document's own dir is set by the i18n provider.
  return (
    <DirectionProvider dir={dir}>
      <Router key={locale} />
    </DirectionProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AuthProvider>
            <I18nProvider>
              <LocaleKeyedRouter />
              <Toaster />
            </I18nProvider>
          </AuthProvider>
        </WouterRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
