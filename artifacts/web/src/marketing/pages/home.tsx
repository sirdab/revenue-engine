import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpFromLine,
  Braces,
  Check,
  Container,
  Hash,
  Plus,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { AppWindow } from "../components/app-window";
import {
  AskAiArt,
  AutomationArt,
  CustomersArt,
  ImportArt,
  InsightsArt,
  LanguagesArt,
  PipelineArt,
  TerminalArt,
} from "../components/art";
import { GitHubMark } from "../components/brand";
import { Actions, type PageProps } from "../components/layout";
import { Rich } from "../components/rich";
import type { Faq } from "../content/types";
import { SITE, appPath, pagePath, type Locale } from "../site";

const two = (n: number) => String(n).padStart(2, "0");

function Ticks({ items }: { items: string[] }) {
  return (
    <ul className="ticks">
      {items.map((item) => (
        <li key={item}>
          <Check aria-hidden="true" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function FaqList({ items, locale }: { items: Faq[]; locale: Locale }) {
  return (
    <div className="faq__list">
      {items.map((item, i) => (
        // The first answer is open, so the section never reads as a wall of
        // closed doors (and its text is on the page for anyone searching it).
        <details className="faq__item" key={item.q} open={i === 0}>
          <summary>
            {/* A heading, so the questions show up in a page outline. */}
            <h3>{item.q}</h3>
            <Plus aria-hidden="true" />
          </summary>
          <div className="faq__a">
            {item.a.map((p) => (
              <p key={p}>
                <Rich text={p} locale={locale} />
              </p>
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}

const INTEGRATION_ICON = {
  slack: Hash,
  in: ArrowDownToLine,
  out: ArrowUpFromLine,
  zap: Zap,
} as const;

const OPEN_SOURCE_ICON = [ShieldCheck, Container, Braces] as const;

export function HomePage({ c, locale }: PageProps) {
  const h = c.home;
  const art = [
    <PipelineArt v={h.v.pipeline} key="pipeline" />,
    <CustomersArt v={h.v.customers} key="customers" />,
    <AutomationArt v={h.v.automation} team={h.app.team} key="automation" />,
    <InsightsArt v={h.v.insights} key="insights" />,
    <AskAiArt v={h.v.ai} key="ai" />,
  ];
  return (
    <>
      <section className="hero">
        <div className="hero__glow" aria-hidden="true" data-paint="aura" />
        <div className="wrap hero__copy">
          <a className="chip" href={SITE.githubUrl} rel="noopener">
            <span className="chip__dot" aria-hidden="true" />
            {h.hero.chip}
            <ArrowRight aria-hidden="true" />
          </a>
          <h1 className="display display--xl">
            {h.hero.title[0]} <br className="br-lg" />
            {h.hero.title[1]}
          </h1>
          <p className="lead">{h.hero.lead}</p>
          <div className="hero__cta">
            <Actions c={c} locale={locale} />
          </div>
          <ul className="hero__note">
            {h.hero.notes.map((note) => (
              <li key={note}>
                <Check aria-hidden="true" />
                {note}
              </li>
            ))}
          </ul>
        </div>
        <div className="wrap--wide hero__stage">
          <AppWindow c={c} />
        </div>
      </section>

      <section className="section section--tight">
        <dl className="wrap facts">
          {h.facts.map((fact) => (
            <div className="fact reveal" key={fact.l}>
              <dt className="fact__l">{fact.l}</dt>
              <dd className="fact__n">{fact.n}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="section section--ruled">
        <div className="wrap">
          <p className="display display--lg statement reveal">
            {h.statement.before}
            <em>{h.statement.em}</em>
            {h.statement.after}
          </p>
        </div>
      </section>

      <section className="section section--ruled" id="product">
        <div className="wrap">
          <div className="section__head reveal">
            <span className="eyebrow">{h.product.eyebrow}</span>
            <h2 className="display display--lg">{h.product.title}</h2>
            <p className="lead">{h.product.lead}</p>
          </div>
          <div className="jobs">
            <nav className="jobs__nav" aria-label={h.product.eyebrow} data-spy>
              {h.product.jobs.map((job, i) => (
                <a className="jobs__link" href={`#${job.id}`} key={job.id}>
                  <span>{two(i + 1)}</span>
                  {job.nav}
                </a>
              ))}
            </nav>
            <div className="jobs__list">
              {h.product.jobs.map((job, i) => (
                <article className="job reveal" id={job.id} key={job.id} data-spy-target>
                  <span className="eyebrow">
                    <span className="eyebrow__n">{two(i + 1)}</span>
                    {job.nav}
                  </span>
                  <h3 className="job__title">
                    <strong>{job.lead}</strong> {job.rest}
                  </h3>
                  {art[i]}
                  <ul className="caps">
                    {job.caps.map((cap) => (
                      <li key={cap.t}>
                        <h4 className="cap__t">{cap.t}</h4>
                        <p className="cap__d">{cap.d}</p>
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="section section--ruled">
        <div className="wrap duo">
          <div className="duo__copy reveal">
            <span className="eyebrow">{h.switching.eyebrow}</span>
            <h2 className="display display--md">{h.switching.title}</h2>
            <p className="lead">{h.switching.lead}</p>
            <Ticks items={h.switching.ticks} />
            <a className="link link--arrow" href={pagePath("pipedrive-alternative", locale)}>
              {h.switching.link}
              <ArrowRight aria-hidden="true" />
            </a>
          </div>
          <div className="reveal">
            <ImportArt v={h.v.import} />
          </div>
        </div>
      </section>

      <section className="section night" id="open-source" data-nav-theme="dark">
        <div className="wrap">
          <div className="duo">
            <div className="duo__copy reveal">
              <span className="eyebrow">{h.openSource.eyebrow}</span>
              <h2 className="display display--lg">{h.openSource.title}</h2>
              <p className="lead">{h.openSource.lead}</p>
              <Ticks items={h.openSource.ticks} />
              <div className="hero__cta" style={{ justifyContent: "flex-start" }}>
                <a className="btn btn--paper" href={pagePath("self-hosted-crm", locale)}>
                  {c.common.cta.deployGuide}
                  <ArrowRight aria-hidden="true" />
                </a>
                <a className="btn btn--night" href={SITE.githubUrl} rel="noopener">
                  <GitHubMark />
                  {c.common.cta.source}
                </a>
              </div>
            </div>
            <div className="reveal">
              <TerminalArt v={h.v.term} />
            </div>
          </div>
          <div className="night__cards">
            {h.openSource.cards.map((card, i) => {
              const Icon = OPEN_SOURCE_ICON[i % OPEN_SOURCE_ICON.length];
              return (
                <div className="night__card reveal" key={card.t}>
                  <Icon aria-hidden="true" />
                  <h3>{card.t}</h3>
                  <p>{card.d}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap duo duo--flip">
          <div className="duo__copy reveal">
            <span className="eyebrow">{h.languages.eyebrow}</span>
            <h2 className="display display--md">{h.languages.title}</h2>
            <p className="lead">{h.languages.lead}</p>
            <Ticks items={h.languages.ticks} />
          </div>
          <div className="reveal">
            <LanguagesArt v={h.v.lang} locale={locale} />
          </div>
        </div>
      </section>

      <section className="section section--ruled">
        <div className="wrap">
          <div className="section__head reveal">
            <span className="eyebrow">{h.integrations.eyebrow}</span>
            <h2 className="display display--md">{h.integrations.title}</h2>
            <p className="lead">{h.integrations.lead}</p>
          </div>
          <ul className="grid-3">
            {h.integrations.cards.map((card) => {
              const Icon = INTEGRATION_ICON[card.icon];
              return (
                <li className="card reveal" key={card.t}>
                  <span className="card__icon">
                    <Icon aria-hidden="true" />
                  </span>
                  <h3 className="card__t">{card.t}</h3>
                  <p className="card__d">{card.d}</p>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      <section className="section section--ruled" id="pricing">
        <div className="wrap">
          <div className="section__head section__head--center reveal">
            <span className="eyebrow">{h.pricing.eyebrow}</span>
            <h2 className="display display--lg">{h.pricing.title}</h2>
            <p className="lead">{h.pricing.lead}</p>
          </div>
          <div className="plans">
            {h.pricing.plans.map((plan, i) => (
              <div className={`plan reveal${i === 1 ? " plan--tint" : ""}`} key={plan.name}>
                <div>
                  <h3 className="plan__name">{plan.name}</h3>
                  <p className="plan__sub">{plan.sub}</p>
                </div>
                <p className="plan__price">
                  <b>{plan.price}</b>
                  <span>{plan.per}</span>
                </p>
                <Ticks items={plan.ticks} />
                {i === 0 ? (
                  <a className="btn btn--ink" href={appPath("/signup", locale)}>
                    {plan.cta}
                    <ArrowRight aria-hidden="true" />
                  </a>
                ) : (
                  <a className="btn btn--ghost" href={pagePath("self-hosted-crm", locale)}>
                    {plan.cta}
                    <ArrowRight aria-hidden="true" />
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section section--ruled" id="faq">
        <div className="wrap faq">
          <div className="faq__head reveal">
            <span className="eyebrow">{h.faq.eyebrow}</span>
            <h2 className="display display--md">{h.faq.title}</h2>
            <p className="lead">
              <Rich text={h.faq.lead} locale={locale} />
            </p>
          </div>
          <FaqList items={h.faq.items} locale={locale} />
        </div>
      </section>

      <Closer c={c} locale={locale} />
    </>
  );
}

export function Closer({ c, locale }: Pick<PageProps, "c" | "locale">) {
  return (
    <div className="wrap--wide">
      <section className="closer grain reveal" data-nav-theme="dark" data-paint="dusk" data-paint-anchor="bottom">
        <h2 className="display display--lg">{c.home.closer.title}</h2>
        <p className="lead">{c.home.closer.lead}</p>
        <div className="hero__cta">
          <Actions c={c} locale={locale} second="star" tone="dark" />
        </div>
      </section>
    </div>
  );
}
