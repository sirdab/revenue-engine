import type { ReactNode } from "react";
import { ArrowRight, Menu, X } from "lucide-react";
import type { Content } from "../content/types";
import {
  LOCALES,
  LOCALE_META,
  SITE,
  appPath,
  pagePath,
  repoFile,
  type Locale,
  type PageId,
} from "../site";
import { BrandMark, GitHubMark } from "./brand";

export interface PageProps {
  c: Content;
  locale: Locale;
  page: PageId;
}

/** The other language's version of the page being read. */
function otherLocale(locale: Locale): Locale {
  return LOCALES.find((l) => l !== locale) ?? locale;
}

function Nav({ c, locale, page }: PageProps) {
  const t = c.common.nav;
  const home = pagePath("home", locale);
  const other = otherLocale(locale);
  const links = (
    <>
      <a className="nav__link" href={`${home}#product`}>
        {t.product}
      </a>
      <a className="nav__link" href={pagePath("open-source-crm", locale)}>
        {t.openSource}
      </a>
      <a className="nav__link" href={pagePath("self-hosted-crm", locale)}>
        {t.selfHost}
      </a>
      <a className="nav__link" href={SITE.githubUrl} rel="noopener">
        <GitHubMark />
        {t.github}
      </a>
    </>
  );
  const language = (
    <a
      className="nav__link"
      href={pagePath(page, other)}
      hrefLang={LOCALE_META[other].htmlLang}
      lang={LOCALE_META[other].htmlLang}
    >
      {LOCALE_META[other].label}
    </a>
  );
  return (
    <header className="nav" data-nav>
      <div className="nav__row">
        <a className="nav__tile nav__brand" href={home} aria-label={`${SITE.name}: ${c.common.home}`}>
          <BrandMark className="nav__mark" />
          <span>{SITE.name}</span>
        </a>
        <div className="nav__tile nav__actions">
          <nav className="nav__links" aria-label={t.primary}>
            {links}
            {language}
            <span className="nav__sep" aria-hidden="true" />
            <a className="nav__link" href={appPath("/login", locale)}>
              {t.signIn}
            </a>
          </nav>
          <a className="btn btn--ink btn--sm" href={appPath("/signup", locale)}>
            {t.start}
          </a>
          <button
            className="nav__toggle"
            type="button"
            aria-expanded="false"
            aria-controls="nav-sheet"
            aria-label={t.menu}
            data-nav-toggle
          >
            <Menu className="nav__open" aria-hidden="true" />
            <X className="nav__close" aria-hidden="true" />
          </button>
        </div>
      </div>
      <nav className="nav__sheet" id="nav-sheet" aria-label={t.menu} hidden>
        {links}
        {language}
        <a className="nav__link" href={appPath("/login", locale)}>
          {t.signIn}
        </a>
      </nav>
    </header>
  );
}

function Footer({ c, locale, page }: PageProps) {
  const f = c.common.footer;
  const g = c.guides;
  const home = pagePath("home", locale);
  return (
    <footer className="footer" data-nav-theme="dark">
      <div className="wrap">
        <div className="footer__grid">
          <div className="footer__col">
            <h2 className="footer__h">{f.product}</h2>
            <ul className="footer__links">
              <li>
                <a href={`${home}#product`}>{f.features}</a>
              </li>
              <li>
                <a href={pagePath("open-source-crm", locale)}>{g["open-source-crm"].name}</a>
              </li>
              <li>
                <a href={pagePath("self-hosted-crm", locale)}>{g["self-hosted-crm"].name}</a>
              </li>
              <li>
                <a href={pagePath("pipedrive-alternative", locale)}>{g["pipedrive-alternative"].name}</a>
              </li>
              {(["crm-software", "sales-management", "free-crm", "arabic-crm"] as const).map((p) => (
                <li key={p}>
                  <a href={pagePath(p, locale)}>{g[p].name}</a>
                </li>
              ))}
            </ul>
          </div>
          <div className="footer__col">
            <h2 className="footer__h">{f.developers}</h2>
            <ul className="footer__links">
              <li>
                <a href={SITE.githubUrl} rel="noopener">
                  {c.common.nav.github}
                </a>
              </li>
              <li>
                <a href={repoFile("DEPLOY.md")} rel="noopener">
                  {f.deployGuide}
                </a>
              </li>
              <li>
                <a href={repoFile("SCHEMA.md")} rel="noopener">
                  {f.schema}
                </a>
              </li>
              <li>
                <a href={repoFile("CONTRIBUTING.md")} rel="noopener">
                  {f.contributing}
                </a>
              </li>
            </ul>
          </div>
          <div className="footer__col">
            <h2 className="footer__h">{f.project}</h2>
            <ul className="footer__links">
              <li>
                <a href={SITE.licenseUrl} rel="noopener">
                  {f.license}
                </a>
              </li>
              <li>
                <a href={repoFile("SECURITY.md")} rel="noopener">
                  {f.security}
                </a>
              </li>
              <li>
                <a href={repoFile("TRADEMARKS.md")} rel="noopener">
                  {f.trademarks}
                </a>
              </li>
              <li>
                <a href={SITE.designSystemUrl} rel="noopener">
                  {f.designSystem}
                </a>
              </li>
            </ul>
          </div>
          <div className="footer__col footer__about">
            <div className="footer__tags">
              <span className="footer__tag footer__tag--solid">
                <span className="chip__dot" aria-hidden="true" />
                {SITE.license}
              </span>
              <a className="footer__tag" href={SITE.companyUrl} rel="noopener">
                {f.builtBy}
              </a>
            </div>
            <p className="footer__blurb">{f.blurb}</p>
          </div>
        </div>
        <div className="footer__base">
          <p>
            © {new Date().getFullYear()} {SITE.company}. {f.rights}
          </p>
          <nav className="footer__langs" aria-label={f.language}>
            {LOCALES.map((l) => (
              <a
                key={l}
                href={pagePath(page, l)}
                hrefLang={LOCALE_META[l].htmlLang}
                lang={LOCALE_META[l].htmlLang}
                aria-current={l === locale ? "true" : undefined}
              >
                {LOCALE_META[l].label}
              </a>
            ))}
          </nav>
        </div>
      </div>
    </footer>
  );
}

export function Shell({ children, ...props }: PageProps & { children: ReactNode }) {
  return (
    <>
      <a className="skip" href="#main">
        {props.c.common.skip}
      </a>
      <Nav {...props} />
      <main id="main">{children}</main>
      <Footer {...props} />
    </>
  );
}

/** Start for free + a second action; the pair that closes most sections. */
export function Actions({
  c,
  locale,
  size = "lg",
  second = "github",
  tone = "paper",
}: {
  c: Content;
  locale: Locale;
  size?: "md" | "lg";
  second?: "github" | "star";
  /** The surface the buttons sit on. */
  tone?: "paper" | "dark";
}) {
  const sz = size === "lg" ? " btn--lg" : "";
  return (
    <>
      <a className={`btn ${tone === "dark" ? "btn--paper" : "btn--ink"}${sz}`} href={appPath("/signup", locale)}>
        {c.common.cta.start}
        <ArrowRight aria-hidden="true" />
      </a>
      <a className={`btn ${tone === "dark" ? "btn--night" : "btn--ghost"}${sz}`} href={SITE.githubUrl} rel="noopener">
        <GitHubMark />
        {second === "star" ? c.common.cta.star : c.common.cta.github}
      </a>
    </>
  );
}
