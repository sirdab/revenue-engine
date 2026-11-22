import { Check, CircleDashed, Copy, Info, Minus, TriangleAlert } from "lucide-react";
import { Actions, type PageProps } from "../components/layout";
import { Rich } from "../components/rich";
import type { Block, Content } from "../content/types";
import { pagePath, type Locale, type PageId } from "../site";
import { Closer, FaqList } from "./home";

// The longer pages (open source, self-hosting, comparisons) share one layout:
// a headline, a table of contents that follows the reader, and sections built
// from a handful of block types. The copy decides the content; this file only
// decides how each kind of block looks.

const MARK = {
  yes: { icon: Check, className: "yes" },
  no: { icon: Minus, className: "no" },
  part: { icon: CircleDashed, className: "part" },
} as const;

function Cell({ value, locale }: { value: string; locale: Locale }) {
  const m = /^(yes|no|part):(.*)$/.exec(value);
  if (!m) return <Rich text={value} locale={locale} />;
  const { icon: Icon, className } = MARK[m[1] as keyof typeof MARK];
  return (
    <span className={className}>
      <Icon aria-hidden="true" />
      <Rich text={m[2]} locale={locale} />
    </span>
  );
}

/** A trailing `# note` (or a whole `#` line) is dimmed; the rest is the command. */
function CodeLine({ line }: { line: string }) {
  const at = line.startsWith("#") ? 0 : line.search(/\s{2,}#\s/);
  if (at < 0) return <>{line}</>;
  return (
    <>
      {line.slice(0, at)}
      <span className="cm">{line.slice(at)}</span>
    </>
  );
}

function BlockView({ block, c, locale }: { block: Block; c: Content; locale: Locale }) {
  switch (block.kind) {
    case "p":
      return (
        <div className="prose">
          {block.text.map((p) => (
            <p key={p}>
              <Rich text={p} locale={locale} />
            </p>
          ))}
        </div>
      );
    case "bullets":
      return (
        <ul className="bullets">
          {block.items.map((item) => (
            <li key={item}>
              <span>
                <Rich text={item} locale={locale} />
              </span>
            </li>
          ))}
        </ul>
      );
    case "steps":
      return (
        <ol className="steps">
          {block.items.map((step) => (
            <li key={step.t}>
              <h3>{step.t}</h3>
              <p>
                <Rich text={step.d} locale={locale} />
              </p>
            </li>
          ))}
        </ol>
      );
    case "code":
      return (
        <div className="code">
          <div className="code__bar">
            <span>{block.label}</span>
            <button
              className="code__copy"
              type="button"
              data-copy={block.code}
              data-copied={c.common.copied}
            >
              <Copy aria-hidden="true" />
              <span>{c.common.copy}</span>
            </button>
          </div>
          <pre tabIndex={0} aria-label={block.label}>
            <code>
              {block.code.split("\n").map((line, i) => (
                <span key={i}>
                  <CodeLine line={line} />
                  {"\n"}
                </span>
              ))}
            </code>
          </pre>
        </div>
      );
    case "table":
      return (
        <div className="table" tabIndex={0} role="group" aria-label={block.head.filter(Boolean).join(", ")}>
          <table>
            <thead>
              <tr>
                {block.head.map((h, i) =>
                  // An empty corner cell is not a heading of anything.
                  h ? (
                    <th scope="col" key={i}>
                      {h}
                    </th>
                  ) : (
                    <td key={i} />
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row) => (
                <tr key={row[0]}>
                  {row.map((cell, i) =>
                    i === 0 ? (
                      <th scope="row" key={i}>
                        <Rich text={cell} locale={locale} />
                      </th>
                    ) : (
                      <td key={i}>
                        <Cell value={cell} locale={locale} />
                      </td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "callout": {
      const Icon = block.tone === "warn" ? TriangleAlert : Info;
      return (
        <p className={`callout${block.tone === "warn" ? " callout--warn" : ""}`}>
          <Icon aria-hidden="true" />
          <span>
            <Rich text={block.text} locale={locale} />
          </span>
        </p>
      );
    }
    case "fine":
      return (
        <p className="fine">
          <Rich text={block.text} locale={locale} />
        </p>
      );
  }
}

export function GuidePage({ c, locale, page }: PageProps) {
  const g = c.guides[page as Exclude<PageId, "home">];
  return (
    <>
      <section className="guide-hero">
        <div className="guide-hero__glow" aria-hidden="true" />
        <div className="wrap">
          <div className="guide-hero__inner">
            <nav className="crumbs" aria-label={c.common.breadcrumb}>
              <a href={pagePath("home", locale)}>{c.common.home}</a>
              <span aria-hidden="true">/</span>
              <span aria-current="page">{g.name}</span>
            </nav>
            <span className="eyebrow">{g.eyebrow}</span>
            <h1 className="display display--lg">{g.h1}</h1>
            <p className="lead">{g.lead}</p>
            <div className="hero__cta" style={{ justifyContent: "flex-start" }}>
              <Actions c={c} locale={locale} size="md" />
            </div>
          </div>
        </div>
      </section>

      <div className="wrap">
        <div className="guide">
          <nav className="guide__toc" aria-label={g.name} data-spy>
            {g.sections.map((s) => (
              <a href={`#${s.id}`} key={s.id}>
                {s.nav}
              </a>
            ))}
          </nav>
          <div className="guide__body">
            {g.sections.map((s) => (
              <section className="block reveal" id={s.id} key={s.id} data-spy-target>
                <h2 className="display display--md">{s.title}</h2>
                {s.blocks.map((block, i) => (
                  <BlockView block={block} c={c} locale={locale} key={i} />
                ))}
              </section>
            ))}
          </div>
        </div>
      </div>

      <section className="section" id="faq">
        <div className="wrap faq">
          <div className="faq__head reveal">
            <span className="eyebrow">{c.home.faq.eyebrow}</span>
            <h2 className="display display--md">{g.faqTitle}</h2>
          </div>
          <FaqList items={g.faq} locale={locale} />
        </div>
      </section>

      <Closer c={c} locale={locale} />
    </>
  );
}
