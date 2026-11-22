import React from "react";
import { GitBranch, KanbanSquare, Sparkles, Zap } from "lucide-react";
import { BrandMark } from "@/components/layout/brand-mark";
import { LanguageToggle } from "@/components/layout/language-switcher";
import { useI18n } from "@/lib/i18n/i18n";

interface AuthShellProps {
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

const GITHUB_URL = "https://github.com/sirdab/revenue-engine";

/**
 * The one layout for every signed-out page (sign in, sign up, forgot and
 * reset password): the form on one side, and on wide screens a brand panel
 * that says what the product is, so the first screen a new team sees is not
 * just a stock image.
 *
 * Fixed to the viewport: the brand panel always fills its half, and only the
 * form column scrolls when the window is short.
 */
export function AuthShell({ title, subtitle, children, footer }: AuthShellProps) {
  const { t } = useI18n();
  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-background">
      <BrandPanel />

      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto overscroll-contain">
        <header className="flex items-center justify-between gap-4 px-6 pt-6 lg:px-10">
          {/* A plain link, not a router one: the landing page is served by the
              server, outside this app. */}
          <a
            href={import.meta.env.BASE_URL}
            className="inline-flex rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <BrandMark />
          </a>
          <LanguageToggle />
        </header>

        {/* my-auto centers vertically when there's room but, unlike
            justify-center on the scroll container, never clips the top
            when the window is shorter than the form. */}
        <main className="mx-auto my-auto w-full max-w-[400px] px-6 py-12 animate-in fade-in slide-in-from-bottom-4 duration-700">
          <h1 className="mb-2 font-heading text-heading-sm font-semibold tracking-tight text-foreground">
            {title}
          </h1>
          {subtitle && <p className="mb-8 text-body text-muted-foreground">{subtitle}</p>}
          {!subtitle && <div className="mb-8" />}

          {children}

          {footer && <div className="mt-8 text-body">{footer}</div>}
        </main>

        <footer className="flex flex-wrap items-center justify-between gap-2 px-6 pb-6 text-caption text-subtle lg:px-10">
          <span>{t("auth.shell.builtBy")}</span>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <GitBranch className="h-3.5 w-3.5" />
            {t("auth.shell.openSource")}
          </a>
        </footer>
      </div>
    </div>
  );
}

function BrandPanel() {
  const { t } = useI18n();
  const points = [
    { icon: KanbanSquare, text: t("auth.shell.point.pipeline") },
    { icon: Zap, text: t("auth.shell.point.automations") },
    { icon: Sparkles, text: t("auth.shell.point.ai") },
  ];
  return (
    <aside className="relative hidden w-[46%] max-w-[760px] shrink-0 overflow-hidden lg:flex lg:flex-col lg:justify-end">
      <img
        src="/side-bg.png"
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = "none";
        }}
      />
      {/* Deepens the lower half so the copy reads on any part of the image. */}
      <div className="absolute inset-0 bg-gradient-to-t from-[#06262b]/90 via-[#06262b]/45 to-transparent" />

      <div className="relative z-10 px-12 pb-14 xl:px-16">
        <PipelinePreview />

        <p className="mb-3 text-caption font-medium uppercase tracking-[0.08em] text-white/70">
          {t("auth.shell.eyebrow")}
        </p>
        <h2 className="max-w-[18ch] font-heading text-[2.25rem] font-semibold leading-[1.1] tracking-tight text-white xl:text-[2.6rem]">
          {t("auth.shell.headline")}
        </h2>
        <ul className="mt-8 space-y-3">
          {points.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-center gap-3 text-body text-white/85">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/15">
                <Icon className="h-4 w-4" />
              </span>
              {text}
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}

/**
 * A small, static picture of the product: three deals moving through stages.
 * Illustration only (aria-hidden); the names are sample data.
 */
function PipelinePreview() {
  const { t } = useI18n();
  const columns = [
    { stage: t("auth.shell.preview.qualified"), deals: [{ name: "Najd Retail", w: "w-3/5" }, { name: "Kite Learning", w: "w-2/5" }] },
    { stage: t("auth.shell.preview.proposal"), deals: [{ name: "Marwa Clinics", w: "w-4/5" }] },
    { stage: t("auth.shell.preview.won"), deals: [{ name: "Lumen Freight", w: "w-full" }] },
  ];
  return (
    <div
      aria-hidden="true"
      className="mb-12 grid max-w-[440px] grid-cols-3 gap-2.5 rounded-2xl bg-white/[0.07] p-3 ring-1 ring-white/15 backdrop-blur-md"
    >
      {columns.map((col, i) => (
        <div key={col.stage} className="space-y-2">
          <div className="flex items-center gap-1.5 px-1 text-[11px] font-medium text-white/70">
            <span className={i === 2 ? "h-1.5 w-1.5 rounded-full bg-[#5fd3c4]" : "h-1.5 w-1.5 rounded-full bg-white/50"} />
            <span className="truncate">{col.stage}</span>
          </div>
          {col.deals.map((deal) => (
            <div key={deal.name} className="rounded-lg bg-white/90 p-2 shadow-sm">
              <div dir="ltr" className="truncate text-start text-[11px] font-medium text-[#10282c]">
                {deal.name}
              </div>
              <div className="mt-1.5 h-1 rounded-full bg-[#10282c]/10">
                <div className={`${deal.w} h-1 rounded-full bg-[#027787]`} />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
