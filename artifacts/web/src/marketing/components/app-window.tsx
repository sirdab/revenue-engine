import type { CSSProperties } from "react";
import {
  Bell,
  Bookmark,
  Building2,
  CalendarDays,
  ChartColumn,
  ChartNoAxesCombined,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  Filter,
  History,
  House,
  Kanban,
  Languages,
  LayoutGrid,
  List,
  Maximize2,
  Moon,
  MousePointer2,
  PanelLeft,
  PanelRight,
  Play,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import type { BoardDeal, Content } from "../content/types";
import { BrandMark } from "./brand";

// The hero's product window: the deals page as the app draws it. A drawing,
// not a screenshot, so it is sharp, quick and in the reader's language.
//
// As HTML alone it is a still: the board, one card mid-drag, a deal open in the
// side drawer. client/board.ts then makes it work: cards drag between stages,
// the four views switch, a card opens in the drawer, search finds a deal, and
// a tour plays until the visitor takes over. Everything that script needs is
// in the markup here (the other views, every deal's details), so the script
// carries no copy and the page needs no second request.
//
// It stays decoration to assistive technology: one image, with a caption that
// says what it shows. Nothing inside can take keyboard focus.

/** Win probability of each stage, in percent. */
const PROBABILITY = [10, 20, 40, 60, 80];
/** Deals that entered each stage: the numbers the insights drawing charts. */
const ENTERED = [64, 48, 31, 19, 12];
/** Top of the forecast chart's value axis. */
const AXIS_MAX = 160_000;

const amount = (value: string) => Number(value.replace(/[^\d]/g, ""));
const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

interface Placed {
  id: string;
  deal: BoardDeal;
  stage: number;
  held?: boolean;
}

function DealCard({ p, owner }: { p: Placed; owner: string }) {
  const { deal } = p;
  const age = deal.heat ? ` deal__age--${deal.heat}` : "";
  return (
    <div
      className={`deal${p.held ? " deal--held" : ""}${deal.open ? " deal--open" : ""}`}
      data-deal={p.id}
      data-value={amount(deal.value)}
      data-month={deal.month}
      data-owner={owner}
      data-close={deal.close}
      data-last={deal.last}
      data-tone={deal.tone}
      data-rich={deal.open ? "" : undefined}
    >
      <div className="deal__top">
        <span className={`dot dot--${deal.tone}`} />
        <span className="deal__title">{deal.title}</span>
        <span className="deal__who">{deal.who}</span>
      </div>
      <div className="deal__meta">
        <span className="deal__value">{deal.value}</span>
        <span className="deal__org">{deal.org}</span>
        <span className={`deal__age${age}`}>{deal.age}</span>
      </div>
      {p.held && <MousePointer2 className="app__cursor" fill="currentColor" />}
    </div>
  );
}

export function AppWindow({ c }: { c: Content }) {
  const a = c.home.app;
  const d = a.drawer;
  // The dragged card is leaving the second column for the slot in the third.
  const FROM = 1;
  const TO = 2;
  const owner = (id: string) => a.team.find((person) => person.id === id)?.name ?? id;

  const placed: Placed[] = a.columns
    .flatMap((col, stage) => [
      ...col.deals.map((deal) => ({ deal, stage })),
      ...(stage === FROM ? [{ deal: a.held, stage, held: true }] : []),
    ])
    .map((p, i) => ({ ...p, id: `d${i}` }));

  const months = a.forecast.months.map((name, m) => {
    const inMonth = placed.filter((p) => p.deal.month === m);
    return {
      name,
      total: inMonth.reduce((sum, p) => sum + amount(p.deal.value), 0),
      weighted: inMonth.reduce((sum, p) => sum + (amount(p.deal.value) * PROBABILITY[p.stage]) / 100, 0),
    };
  });
  const total = months.reduce((sum, m) => sum + m.total, 0);
  const weighted = months.reduce((sum, m) => sum + m.weighted, 0);

  return (
    <>
      <figure className="app" role="img" aria-label={a.alt} data-board>
        <div className="app__window" aria-hidden="true">
          <aside className="app__side">
            <div className="app__ws">
              <BrandMark />
              <span>{a.workspace}</span>
              <PanelLeft />
            </div>
            <div className="app__group">{a.menu}</div>
            <div className="app__item">
              <House />
              <span>{a.nav.home}</span>
            </div>
            <div className="app__item">
              <ChartColumn />
              <span>{a.nav.insights}</span>
            </div>
            <div className="app__item app__item--on">
              <LayoutGrid />
              <span>{a.nav.deals}</span>
            </div>
            <div className="app__item">
              <Users />
              <span>{a.nav.contacts}</span>
            </div>
            <div className="app__item">
              <CalendarDays />
              <span>{a.nav.activities}</span>
            </div>
            <div className="app__group">{a.admin}</div>
            <div className="app__item">
              <Sparkles />
              <span>{a.nav.askAi}</span>
              <span className="app__beta">{a.nav.beta}</span>
            </div>
            <div className="app__item">
              <Settings />
              <span>{a.nav.users}</span>
            </div>
            <div className="app__item">
              <SlidersHorizontal />
              <span>{a.nav.settings}</span>
            </div>
          </aside>

          <div className="app__main">
            <div className="app__top">
              <div className="app__search" data-board-search>
                <Search />
                <span>{a.search}</span>
                <kbd className="app__kbd">⌘K</kbd>
              </div>
              <span className="app__spacer" />
              <Bell />
              <History />
              <Languages />
              <Moon />
              <span className="app__avatar">{a.user}</span>
            </div>

            <div className="app__head">
              <span className="app__title">{a.title}</span>
              <span className="app__count">
                <b>{a.count[0]}</b> {a.count[1]}
              </span>
              <span className="app__spacer" />
              <span className="app__seg">
                <span>
                  <Maximize2 />
                  {a.fullPage}
                </span>
                <span className="is-on">
                  <PanelRight />
                  {a.sideDrawer}
                </span>
              </span>
              <span className="app__btn app__btn--solid">
                <Plus />
                {a.newDeal}
                <ChevronDown />
              </span>
            </div>

            <div className="app__bar">
              <span className="app__seg" data-board-tabs>
                <span className="is-on" data-view="pipeline">
                  <Kanban />
                  {a.views.pipeline}
                </span>
                <span data-view="list">
                  <List />
                  {a.views.list}
                </span>
                <span data-view="forecast">
                  <ChartNoAxesCombined />
                  {a.views.forecast}
                </span>
                <span data-view="funnel">
                  <Filter />
                  {a.views.funnel}
                </span>
              </span>
              <span className="app__spacer" />
              <span className="app__select">
                {a.allPipelines}
                <ChevronDown />
              </span>
              <span className="app__select">
                {a.allOwners}
                <ChevronDown />
              </span>
              <span className="app__btn">
                <Filter />
                {a.filter}
              </span>
              <span className="app__btn">
                <Bookmark />
                {a.savedViews}
              </span>
            </div>

            <div className="app__views">
              {/* Pipeline: the board. */}
              <div className="app__view is-on" data-panel="pipeline">
                <div className="app__legend">
                  {(["late", "today", "ok", "idle"] as const).map((tone) => (
                    <span key={tone}>
                      <i className={`dot dot--${tone}`} />
                      <span data-legend={tone}>{a.legend[tone]}</span>
                    </span>
                  ))}
                </div>
                <div className="board">
                  {a.columns.map((col, i) => (
                    <div className="board__col" key={col.name} data-col={i}>
                      <div className="board__head">
                        <span className="board__name">{col.name}</span>
                        <span className="board__n">{col.deals.length + (i === FROM ? 1 : 0)}</span>
                        <span className="board__sum">{col.sum}</span>
                      </div>
                      {i === TO && <div className="deal deal--slot" />}
                      {placed
                        .filter((p) => p.stage === i)
                        .map((p) => (
                          <DealCard p={p} owner={owner(p.deal.who)} key={p.id} />
                        ))}
                    </div>
                  ))}
                </div>
              </div>

              {/* List: every deal as a row. */}
              <div className="app__view" data-panel="list" hidden>
                <div className="tbl">
                  <div className="tbl__meta">{a.list.total}</div>
                  <div className="tbl__row tbl__row--head">
                    <i className="tbl__check" />
                    <span>{a.list.title}</span>
                    <span>{a.list.org}</span>
                    <span className="tbl__num">{a.list.value}</span>
                    <span>{a.list.stage}</span>
                    <span>{a.list.owner}</span>
                    <span>{a.list.status}</span>
                  </div>
                  {placed.map((p) => (
                    <div className="tbl__row" key={p.id} data-row={p.id}>
                      <i className="tbl__check" />
                      <span className="tbl__title">
                        <i className={`dot dot--${p.deal.tone}`} />
                        <span>{p.deal.title}</span>
                      </span>
                      <span className="tbl__dim">{p.deal.org}</span>
                      <span className="tbl__num">
                        <span className="ltr">{p.deal.value}</span>
                      </span>
                      <span className="tbl__stage">
                        <span data-row-stage>{a.columns[p.stage].name}</span>
                        <ChevronDown />
                      </span>
                      <span className="tbl__owner">
                        <span className="deal__who">{p.deal.who}</span>
                        <span>{owner(p.deal.who)}</span>
                      </span>
                      <span>
                        <span className="tbl__pill">
                          <i className="dot dot--idle" />
                          {a.list.open}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Forecast: value by expected close month, total and weighted. */}
              <div className="app__view" data-panel="forecast" hidden>
                <div className="tiles">
                  <div className="tile">
                    <span>{a.forecast.open}</span>
                    <b>{a.count[0]}</b>
                  </div>
                  <div className="tile">
                    <span>{a.forecast.total}</span>
                    <b className="ltr">{money(total)}</b>
                  </div>
                  <div className="tile tile--teal">
                    <span>{a.forecast.weighted}</span>
                    <b className="ltr" data-weighted={Math.round(weighted)}>
                      {money(weighted)}
                    </b>
                  </div>
                </div>
                <div className="chart">
                  <div className="chart__t">{a.forecast.chart}</div>
                  <div className="chart__plot" data-axis-max={AXIS_MAX}>
                    <div className="chart__y">
                      {[1, 0.75, 0.5, 0.25, 0].map((f) => (
                        <span key={f}>{f === 0 ? "$0" : `$${(AXIS_MAX * f) / 1000}k`}</span>
                      ))}
                    </div>
                    <div className="chart__bars">
                      {months.map((m, i) => (
                        <div className="chart__m" key={m.name}>
                          <div className="chart__pair">
                            <i className="bar" style={{ "--h": (m.total / AXIS_MAX).toFixed(4) } as CSSProperties} />
                            <i
                              className="bar bar--teal"
                              data-wbar={i}
                              style={{ "--h": (m.weighted / AXIS_MAX).toFixed(4) } as CSSProperties}
                            />
                          </div>
                          <span>{m.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="chart__legend">
                    <span>
                      <i className="swatch" />
                      {a.forecast.legend[0]}
                    </span>
                    <span>
                      <i className="swatch swatch--teal" />
                      {a.forecast.legend[1]}
                    </span>
                  </div>
                </div>
              </div>

              {/* Funnel: how many deals reached each stage. */}
              <div className="app__view" data-panel="funnel" hidden>
                <div className="tiles">
                  <div className="tile">
                    <span>{a.funnel.pipeline}</span>
                    <b>{a.allPipelines}</b>
                  </div>
                  <div className="tile">
                    <span>{a.funnel.entered}</span>
                    <b>{ENTERED[0]}</b>
                  </div>
                  <div className="tile">
                    <span>{a.funnel.stages}</span>
                    <b>{a.columns.length}</b>
                  </div>
                </div>
                <div className="chart">
                  <div className="chart__t">{a.funnel.chart}</div>
                  <div className="funnel">
                    {a.columns.map((col, i) => (
                      <div className="funnel__row" key={col.name}>
                        <span className="funnel__name">{col.name}</span>
                        <span className="funnel__n">
                          {ENTERED[i]} {a.funnel.unit}
                        </span>
                        <span className="funnel__track">
                          <i style={{ "--w": (ENTERED[i] / ENTERED[0]).toFixed(4) } as CSSProperties} />
                        </span>
                        <span className="funnel__pct">
                          {i < ENTERED.length - 1 ? `${Math.round((ENTERED[i + 1] / ENTERED[i]) * 100)}%` : "–"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* The search palette: every deal, and one contact, ready to filter. */}
          <div className="palette" data-board-palette hidden>
            <div className="palette__box">
              <div className="palette__in">
                <Search />
                <input type="text" tabIndex={-1} placeholder={a.search} autoComplete="off" spellCheck={false} />
                <kbd className="app__kbd">esc</kbd>
              </div>
              <div className="palette__list">
                <div className="palette__group" data-group="deals">
                  {a.palette.deals}
                </div>
                {placed.map((p) => (
                  <div className="palette__row" key={p.id} data-open={p.id} data-group="deals">
                    <i className={`dot dot--${p.deal.tone}`} />
                    <span className="palette__t">{p.deal.title}</span>
                    <span className="palette__s ltr">{p.deal.value}</span>
                  </div>
                ))}
                <div className="palette__group" data-group="people">
                  {a.palette.people}
                </div>
                <div className="palette__row" data-group="people">
                  <span className="deal__who">{a.palette.person.initials}</span>
                  <span className="palette__t">{a.palette.person.name}</span>
                  <span className="palette__s">{a.palette.person.role}</span>
                </div>
                <div className="palette__none" hidden>
                  {a.palette.none}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="drawer" aria-hidden="true" data-board-drawer>
          <div className="drawer__bar">
            <span data-drawer-close>
              <ChevronLeft />
              {d.back}
            </span>
            <X data-drawer-close />
          </div>
          <div className="drawer__body">
            <div>
              <div className="drawer__title" data-d="title">
                {d.title}
              </div>
              <div className="drawer__sub">
                <b data-d="value">{d.value}</b>
                <span>
                  <span className="deal__who" data-d="who">
                    {a.user}
                  </span>
                  <span data-d="owner">{d.owner}</span>
                </span>
                <span>
                  <Building2 />
                  <span data-d="org">{d.org}</span>
                </span>
              </div>
            </div>
            <div className="stages">
              {d.stages.map((stage, i) => (
                <span
                  key={stage}
                  data-stage={i}
                  className={i === d.stageOn ? "is-on" : i < d.stageOn ? "is-done" : undefined}
                >
                  {stage}
                </span>
              ))}
            </div>
            <dl className="kv">
              {d.facts.map((f, i) => (
                <div key={f.k}>
                  <dt>{f.k}</dt>
                  <dd data-d={["prob", "close", "last"][i]}>{f.v}</dd>
                </div>
              ))}
            </dl>
            <div className="task" data-d="task">
              <span className="task__icon">
                <CheckSquare />
              </span>
              <span>
                <span className="task__t">{d.task.t}</span>
                <span className="task__d">{d.task.d}</span>
              </span>
              <span className="task__due">{d.task.due}</span>
            </div>
            {/* What a deal without a drawn task shows in its place. */}
            <div className="task" data-d="next" hidden>
              <span className="task__icon">
                <CalendarDays />
              </span>
              <span>
                <span className="task__t" data-d="next-t" />
                <span className="task__d">{d.next}</span>
              </span>
            </div>
            <div className="note" data-d="note">
              <div className="note__by">
                <b>{d.note.by}</b>
                <span>{d.note.when}</span>
              </div>
              <p>
                <span className="mention">{d.note.mention}</span> {d.note.text}
              </p>
            </div>
          </div>
        </div>
      </figure>

      {/* Shown by the script once the window works. */}
      <p className="app-hint" data-board-hint hidden>
        <span className="app-hint__dot" aria-hidden="true" />
        <span className="app-hint__fine">{a.hint}</span>
        <span className="app-hint__coarse">{a.hintTouch}</span>
        <button type="button" className="app-hint__replay" data-board-replay>
          <Play aria-hidden="true" />
          {a.replay}
        </button>
      </p>
    </>
  );
}
