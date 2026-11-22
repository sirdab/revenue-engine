import type { CSSProperties, ReactNode } from "react";
import {
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  ChartArea,
  ChartColumn,
  ChartLine,
  ChartPie,
  Check,
  CircleCheck,
  CloudUpload,
  Database,
  FileSpreadsheet,
  FileText,
  Filter,
  Hash,
  History,
  Languages,
  LayoutGrid,
  List,
  LoaderCircle,
  MessageSquare,
  Moon,
  MousePointer2,
  Phone,
  Search,
  Sparkles,
  Sun,
  Table,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  UserRound,
  Users,
  WandSparkles,
  Zap,
} from "lucide-react";
import type { Content, DotTone } from "../content/types";
import type { Locale } from "../site";
import { BrandMark } from "./brand";

// The product illustrations: small HTML drawings of the app on a marbled
// backdrop. Each is one image to a screen reader (the label says what it
// shows); the drawing inside is hidden from it.
//
// What is drawn here is a still: a moment that makes sense on its own. Where a
// frame names a `scene`, client/scenes.ts then plays it: the card is dragged,
// the automation runs, the answer is written out. Everything a scene shows
// beyond the still travels with the markup (`data`), so the script holds no
// copy. And every screen here is drawn after the real one: its labels are the
// app's own.

type Backdrop = "copper" | "greige" | "mauve" | "teal" | "sand" | "dusk";

function Frame({
  backdrop,
  alt,
  scene,
  data,
  children,
}: {
  backdrop: Backdrop;
  alt: string;
  /** Which sequence in client/scenes plays this drawing. */
  scene?: string;
  /** Copy the scene needs that the still does not show. */
  data?: unknown;
  children: ReactNode;
}) {
  return (
    <figure
      className={`frame frame--${backdrop}`}
      role="img"
      aria-label={alt}
      data-paint={backdrop}
      data-scene={scene}
      data-scene-data={data === undefined ? undefined : JSON.stringify(data)}
    >
      <div className="frame__stage" aria-hidden="true">
        {children}
        {/* The pointer a scene works the drawing with. Out of sight until then. */}
        {scene && <MousePointer2 className="g-cursor" fill="currentColor" />}
      </div>
    </figure>
  );
}

type V = Content["home"]["v"];

const amount = (value: string) => Number(value.replace(/[^\d]/g, ""));
const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

function MiniDeal({ t, v, tone, tag, lift }: { t: string; v: string; tone: DotTone; tag?: string; lift?: boolean }) {
  return (
    <div className={`v-deal${lift ? " v-deal--lift" : ""}`} data-value={amount(v)} data-lift={lift ? "" : undefined}>
      <div className="v-deal__t">
        <span className={`dot dot--${tone}`} />
        {t}
      </div>
      <div className="v-deal__m">
        <b className="ltr">{v}</b>
        {tag && <span className="g-tag g-tag--red">{tag}</span>}
      </div>
    </div>
  );
}

export function PipelineArt({ v }: { v: V["pipeline"] }) {
  const [d0, d1, d2, d3, d4] = v.deals;
  // The card being moved still belongs to the first stage: the move has not
  // gone through. Counts and totals are added up from the cards, so they are
  // right before the move and (the scene recounts) after it.
  const columns: { t: string; v: string; tone: DotTone; tag?: string; lift?: boolean }[][] = [
    [
      { ...d0, tone: "ok" },
      { ...d1, tone: "ok" },
      { ...v.lift, tone: "ok", lift: true },
    ],
    [{ ...d2, tone: "late" }],
    [
      { ...d3, tone: "ok" },
      { ...d4, tone: "today" },
    ],
  ];
  const last = v.req.fields.length - 1;
  return (
    <Frame
      backdrop="copper"
      alt={v.alt}
      scene="pipeline"
      data={{ filled: v.req.filled[1], go: v.req.go, value: v.req.fields[last].v }}
    >
      <div className="g v-board">
        <div className="v-board__cols">
          {columns.map((deals, i) => (
            <div className="v-col" key={v.cols[i]} data-col={i}>
              <div className="v-col__head">
                <b>{v.cols[i]}</b>
                <span data-n>{deals.length}</span>
                <span className="ltr" data-sum>
                  {money(deals.reduce((sum, deal) => sum + amount(deal.v), 0))}
                </span>
              </div>
              {i === 1 && <div className="v-deal v-deal--slot" />}
              {deals.map((deal) => (
                <MiniDeal {...deal} key={deal.t} />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="g v-req" data-req>
        <div className="g__head">
          <TriangleAlert />
          {v.req.title}
        </div>
        <div className="v-req__body">
          <div className="v-req__bar">
            <i style={{ "--w": last / v.req.fields.length } as CSSProperties} data-req-bar />
            <span data-req-count>{v.req.filled[0]}</span>
          </div>
          {v.req.fields.map((field, i) => (
            <div className="v-req__f" key={field.k} data-req-field={i === last ? "" : undefined}>
              <span className={`g-check${i < last ? " g-check--on" : ""}`}>
                <Check />
              </span>
              <span className="g-t">{field.k}</span>
              <span className="v-req__v">{i < last ? field.v : ""}</span>
            </div>
          ))}
          <div className="v-req__foot">
            <span className="g-btn">{v.req.cancel}</span>
            <span className="g-btn g-btn--ink is-off" data-req-go>
              {v.req.wait}
            </span>
          </div>
        </div>
      </div>
      <div className="v-toast" data-toast hidden>
        <CircleCheck />
        {v.toast}
      </div>
    </Frame>
  );
}

const EVENT_ICON = {
  call: { icon: Phone, tone: "teal", tab: "call" },
  note: { icon: MessageSquare, tone: "mauve", tab: "note" },
  file: { icon: FileText, tone: "copper", tab: "history" },
  stage: { icon: History, tone: "sage", tab: "history" },
} as const;

/** Which events each timeline tab keeps, in the order of `tabs`. */
const TABS = ["all", "call", "note", "history"] as const;

export function CustomersArt({ v }: { v: V["customers"] }) {
  const s = v.search;
  // "Proposal-v2.pdf" with the searched word marked, wherever it falls.
  const at = s.file.name.indexOf(s.file.mark);
  return (
    <Frame backdrop="mauve" alt={v.alt} scene="customers" data={{ person: s.person.q, file: s.file.q }}>
      <div className="g v-person">
        <div className="v-person__body">
          <div className="g-row">
            <span className="g-av g-av--lg g-av--mauve">{v.initials}</span>
            <span className="g-grow">
              <span className="g-t" style={{ display: "block", fontSize: "1.12em" }}>
                {v.name}
              </span>
              <span className="g-s">{v.role}</span>
            </span>
          </div>
          <dl className="v-fields">
            {/* The first two are a phone number and an email address. */}
            {v.fields.map((f, i) => (
              <div key={f.k}>
                <dt>{f.k}</dt>
                <dd>{i < 2 ? <span className="ltr">{f.v}</span> : f.v}</dd>
              </div>
            ))}
          </dl>
          <span className="g-tag g-tag--teal" style={{ justifySelf: "start" }}>
            {v.label}
          </span>
        </div>
      </div>
      <div className="g v-timeline">
        <div className="g__head">
          <History />
          {v.timeline}
          <span className="v-tabs" data-tabs>
            {v.tabs.map((tab, i) => (
              <span key={tab} data-tab={TABS[i]} className={i === 0 ? "is-on" : undefined}>
                {tab}
              </span>
            ))}
          </span>
        </div>
        <div className="v-timeline__list">
          {v.events.map((e) => {
            const { icon: Icon, tone, tab } = EVENT_ICON[e.kind];
            return (
              <div className="v-event" key={e.t} data-kind={tab}>
                <span className={`g-ico g-ico--${tone}`}>
                  <Icon />
                </span>
                <div>
                  <div className="v-event__h">
                    <span className="g-t">{e.t}</span>
                    <span className="g-s">{e.when}</span>
                  </div>
                  <p>
                    {e.mention && (
                      <>
                        <span className="mention">{e.mention}</span>{" "}
                      </>
                    )}
                    {e.body}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="g v-search">
        <div className="v-search__q">
          <Search />
          <span className="v-search__in" data-q data-placeholder={s.placeholder}>
            {s.person.q}
          </span>
          <kbd>⌘K</kbd>
        </div>
        <div className="v-search__res" data-res="person">
          <div className="v-search__group">{s.people}</div>
          <div className="v-search__hit">
            <span className="g-av g-av--mauve">{v.initials}</span>
            <span className="g-grow">
              <span className="g-t">
                {v.name} <span className="g-tag">{s.pill}</span>
              </span>
              <span className="g-s">
                {s.person.phone} · {s.person.org}
              </span>
            </span>
          </div>
        </div>
        <div className="v-search__res" data-res="file" hidden>
          <div className="v-search__group">{s.files}</div>
          <div className="v-search__hit">
            <span className="g-ico g-ico--copper">
              <FileText />
            </span>
            <span className="g-grow">
              <span className="g-t ltr">
                {at < 0 ? (
                  s.file.name
                ) : (
                  <>
                    {s.file.name.slice(0, at)}
                    <mark>{s.file.mark}</mark>
                    {s.file.name.slice(at + s.file.mark.length)}
                  </>
                )}
              </span>
              <span className="g-s">{s.file.deal}</span>
            </span>
          </div>
        </div>
      </div>
    </Frame>
  );
}

const NODE_ICON = {
  trigger: { icon: Zap, tone: "gold", id: "when" },
  condition: { icon: Filter, tone: "mauve", id: "if" },
  slack: { icon: Hash, tone: "copper", id: "then" },
} as const;

const ROTA_TONES = ["teal", "copper", "mauve", "sage"];

export function AutomationArt({ v, team }: { v: V["automation"]; team: { id: string; name: string }[] }) {
  const first = v.runs[0];
  const name = (id: string) => team.find((person) => person.id === id)?.name ?? id;
  return (
    <Frame
      backdrop="sand"
      alt={v.alt}
      scene="automation"
      data={{ runs: v.runs, moved: v.moved, incoming: v.rule.incoming, team: v.rule.team.map(name) }}
    >
      <div className="g v-flow">
        {/* The deal that has just changed: what sets the automation off. */}
        <div className="v-chip" data-chip>
          <span className="dot dot--ok" />
          <span className="g-t" data-chip-deal>
            {first.deal}
          </span>
          <b className="ltr" data-chip-value>
            {first.value}
          </b>
        </div>
        {v.nodes.map((node, i) => {
          const { icon: Icon, tone, id } = NODE_ICON[node.icon];
          return (
            <div key={node.t} style={{ display: "contents" }}>
              <span className="g-wire v-flow__wire" data-wire={i} />
              <div className="g v-node" data-node={id}>
                <span className={`g-ico g-ico--${tone}`}>
                  <Icon />
                </span>
                <div>
                  <span className="v-node__k">{node.k}</span>
                  {node.icon === "condition" ? (
                    // Two conditions, each ticked or crossed as a deal is checked.
                    <>
                      <p className="v-node__c is-yes" data-check="0">
                        <i />
                        {node.t}
                      </p>
                      <p className="v-node__c is-yes" data-check="1">
                        <i />
                        {node.s}
                      </p>
                    </>
                  ) : (
                    <p>
                      {node.t}
                      {node.s && <span>{node.s}</span>}
                    </p>
                  )}
                </div>
                {node.icon === "condition" && (
                  <span className="g-tag v-node__no" data-no hidden>
                    {v.noMatch}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="g v-slack">
        <div className="g__head">
          <Hash />
          {v.slack.channel.replace(/^#/, "")}
        </div>
        <div className="v-slack__body" data-slack>
          <BrandMark className="v-slack__mark" />
          <div>
            <div className="g-row" style={{ gap: ".5em" }}>
              <span className="g-t">{v.slack.app}</span>
              <span className="g-tag" style={{ height: "1.45em", fontSize: ".7em" }}>
                {v.slack.badge}
              </span>
              <span className="g-s" data-slack-time>
                {first.time}
              </span>
            </div>
            <div className="v-slack__card">
              <span className="g-t" data-slack-text>
                {v.moved.replace("{deal}", first.deal)}
              </span>
              <dl className="v-slack__f">
                <div>
                  <dt>{v.slack.labels[0]}</dt>
                  <dd className="ltr" data-slack-value>
                    {first.value}
                  </dd>
                </div>
                <div>
                  <dt>{v.slack.labels[1]}</dt>
                  <dd data-slack-owner>{first.owner}</dd>
                </div>
                <div>
                  <dt>{v.slack.labels[2]}</dt>
                  <dd>{v.slack.pipeline}</dd>
                </div>
                <div>
                  <dt>{v.slack.labels[3]}</dt>
                  <dd data-slack-org>{first.org}</dd>
                </div>
              </dl>
              <div className="v-slack__btns">
                <span>{v.slack.open}</span>
                <span>{v.slack.view}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="g v-rule">
        <div className="g__head">
          <Users />
          {v.rule.title}
        </div>
        <div className="v-rule__body">
          <div>
            <span className="g-s" style={{ display: "block" }}>
              {v.rule.when}
            </span>
            <span className="g-t">{v.rule.then}</span>
          </div>
          <div className="v-rota" data-rota>
            {v.rule.team.map((id, i) => (
              <span className={`g-av g-av--${ROTA_TONES[i]}${i === 0 ? " is-next" : ""}`} key={id}>
                {id}
              </span>
            ))}
          </div>
          {/* The latest deal to arrive, and the person whose turn it was. */}
          <div className="v-rule__last" data-last>
            <span className="g-s" data-last-deal>
              {v.rule.incoming[0]}
            </span>
            <ArrowRight />
            <span className="g-t" data-last-who>
              {name(v.rule.team[0])}
            </span>
          </div>
        </div>
      </div>
    </Frame>
  );
}

/** The chart-type picker, in the order the app's widget builder lists them. */
const KINDS = [
  { id: "bar", icon: ChartColumn },
  { id: "list", icon: List },
  { id: "line", icon: ChartLine },
  { id: "area", icon: ChartArea },
  { id: "pie", icon: ChartPie },
  { id: "funnel", icon: TrendingDown },
  { id: "kpi", icon: Hash },
  { id: "table", icon: Table },
] as const;

/** Top of the chart's value axis, in the units of `values`. */
const AXIS = 80;

function Delta({ d, vs }: { d: string; vs: string }) {
  return (
    <span className="v-delta">
      <b className="ltr">
        <TrendingUp />
        {d}
      </b>
      {vs}
    </span>
  );
}

export function InsightsArt({ v }: { v: V["insights"] }) {
  const { months, values } = v.chart;
  const n = values.length;
  const lostMax = Math.max(...v.lost.rows.map((r) => r.n));
  const max = Math.max(...values);
  const total = values.reduce((sum, value) => sum + value, 0);
  const k = (value: number) => `$${value}k`;
  // The line and the area, in a 100 × 100 box that is stretched to the plot.
  const xs = values.map((_, i) => (((i + 0.5) / n) * 100).toFixed(2));
  const points = values.map((value, i) => `${xs[i]},${(100 - (value / AXIS) * 100).toFixed(2)}`);
  // Pie slices as dashes on one circle of circumference 100.
  let turned = 0;
  const slices = values.map((value) => {
    const share = (value / total) * 100;
    const slice = { share, start: turned };
    turned += share;
    return slice;
  });
  return (
    <Frame backdrop="teal" alt={v.alt} scene="insights">
      <div className="g v-dash">
        <div className="g__head">
          <LayoutGrid />
          {v.title}
          <span className="g__end">{v.live}</span>
        </div>
        <div className="v-dash__grid">
          {v.tiles.map((tile) => (
            <div className="v-tile" key={tile.k}>
              <div className="v-tile__k">{tile.k}</div>
              <div className="v-tile__v ltr" data-count>
                {tile.v}
              </div>
              <Delta d={tile.d} vs={v.vs} />
            </div>
          ))}
          <div className="v-tile v-tile--wide" data-widget data-kind="bar">
            <div className="v-tile__k">{v.chart.title}</div>
            <div className="v-plot">
              {/* Bar and funnel: the same columns, the funnel's in a ramp. */}
              <div className="v-plot__cols">
                {values.map((value, i) => (
                  <div key={months[i]}>
                    <b className="ltr">{k(value)}</b>
                    <i style={{ "--h": value / AXIS } as CSSProperties} />
                    <span>{months[i]}</span>
                  </div>
                ))}
              </div>
              {/* Line and area: one path, the area filled beneath it. */}
              <div className="v-plot__line">
                <div className="v-plot__path">
                  <svg viewBox="0 0 100 100" preserveAspectRatio="none">
                    <polygon points={`${xs[0]},100 ${points.join(" ")} ${xs[n - 1]},100`} />
                    <polyline points={points.join(" ")} />
                  </svg>
                  {values.map((value, i) => (
                    <i key={months[i]} style={{ "--x": (i + 0.5) / n, "--y": value / AXIS } as CSSProperties} />
                  ))}
                </div>
                <div className="v-plot__x">
                  {months.map((month) => (
                    <span key={month}>{month}</span>
                  ))}
                </div>
              </div>
              <div className="v-plot__pie">
                <svg viewBox="0 0 42 42">
                  {slices.map((slice, i) => (
                    <circle
                      key={months[i]}
                      cx="21"
                      cy="21"
                      r="15.9155"
                      pathLength={100}
                      style={{ "--share": slice.share, "--start": slice.start } as CSSProperties}
                    />
                  ))}
                </svg>
                <ul>
                  {months.map((month, i) => (
                    <li key={month}>
                      <i />
                      {month}
                      <b className="ltr">{Math.round((values[i] / total) * 100)}%</b>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="v-plot__kpi">
                <b className="ltr">{k(values[n - 1])}</b>
                <Delta d={v.tiles[1].d} vs={v.vs} />
              </div>
              <div className="v-plot__list">
                {values.map((value, i) => (
                  <div key={months[i]}>
                    <i style={{ "--w": value / max } as CSSProperties} />
                    <span>{months[i]}</span>
                    <b className="ltr">{k(value)}</b>
                  </div>
                ))}
              </div>
              <div className="v-plot__table">
                <div>
                  <span>{v.chart.head[0]}</span>
                  <span>{v.chart.head[1]}</span>
                </div>
                {values.map((value, i) => (
                  <div key={months[i]}>
                    <span>{months[i]}</span>
                    <b className="ltr">{money(value * 1000)}</b>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="v-tile v-tile--side">
            <div className="v-tile__k">{v.lost.title}</div>
            <div className="v-bars">
              {v.lost.rows.map((row) => (
                <div key={row.l}>
                  <i style={{ width: `${Math.round((row.n / lostMax) * 100)}%` }} />
                  <span>{row.l}</span>
                  <b>{row.n}</b>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="g v-viz" data-viz>
        <div className="g__head">
          <ChartColumn />
          {v.kinds.title}
        </div>
        <div className="v-viz__grid">
          {KINDS.map(({ id, icon: Icon }) => (
            <span key={id} data-kind={id} className={id === "bar" ? "is-on" : undefined}>
              <Icon />
              {v.kinds.names[id]}
            </span>
          ))}
        </div>
      </div>
    </Frame>
  );
}

export function AskAiArt({ v }: { v: V["ai"] }) {
  const first = v.turns[0];
  return (
    <Frame backdrop="greige" alt={v.alt} scene="ask-ai" data={{ turns: v.turns, thinking: v.thinking }}>
      <div className="g v-chat">
        <div className="g__head">
          <Sparkles />
          {v.title}
          <span className="g-tag g-tag--amber">{v.beta}</span>
        </div>
        <div className="v-chat__body" data-thread>
          {/* The chat before anything is asked. The scene opens on it. */}
          <div className="v-hello" data-hello hidden>
            <b>{v.hello}</b>
            <span>{v.prompt}</span>
          </div>
          <div className="v-ask" data-ask>
            {first.ask}
          </div>
          <div className="v-reply" data-reply>
            <div className="v-reply__by">
              <Sparkles />
              {v.title}
            </div>
            <p className="v-reply__think" data-think hidden />
            <p className="v-reply__text" data-answer>
              {first.answer}
            </p>
            <div className="v-reply__src" data-sources>
              <Database />
              <span>{first.sources}</span>
              <ArrowUpRight />
            </div>
          </div>
        </div>
        <div className="v-composer">
          <span className="v-composer__in is-empty" data-composer data-placeholder={v.placeholder}>
            {v.placeholder}
          </span>
          <span className="v-composer__send" data-send>
            <ArrowUp />
          </span>
        </div>
        <div className="v-chat__foot">{v.foot}</div>
      </div>
      <div className="g v-behind">
        <div className="g__head">
          <Database />
          {v.behind}
        </div>
        <div className="v-behind__body">
          <span className="g-s v-behind__none" data-none hidden>
            {v.railEmpty}
          </span>
          <span className="g-s" data-related>
            {v.related}
          </span>
          <div className="v-behind__list" data-deals>
            {first.deals.map((deal) => (
              <div className="v-behind__deal" key={deal.t}>
                <span className="g-t">{deal.t}</span>
                <span className="g-s">{deal.s}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Frame>
  );
}

export function ImportArt({ v }: { v: V["import"] }) {
  return (
    <Frame backdrop="copper" alt={v.alt} scene="import" data={{ review: v.review, go: v.go, busy: v.busy }}>
      <div className="g v-import">
        <div className="g__head">
          <FileSpreadsheet />
          {v.title}
          <span className="g__end" data-file>
            {v.file}
          </span>
        </div>
        {/* The import's five steps. The still is at the third. */}
        <ol className="v-steps" data-steps>
          {v.steps.map((step, i) => (
            <li key={step} className={i < 2 ? "is-done" : i === 2 ? "is-on" : undefined}>
              <i>
                <Check />
                <span>{i + 1}</span>
              </i>
              <span className="v-steps__t">{step}</span>
            </li>
          ))}
        </ol>
        <div className="v-import__pane" data-pane="upload" hidden>
          <div className="v-drop">
            <CloudUpload />
            {v.drop}
          </div>
        </div>
        <div className="v-import__pane" data-pane="map">
          <div className="v-import__note" data-note>
            <WandSparkles />
            <span>
              <b>{v.noteTitle}</b> {v.note}
            </span>
          </div>
          <div className="v-map">
            {v.rows.map((row) => (
              <div className="v-map__row" key={row.from}>
                <span className="g-tag g-tag--mono ltr">{row.from}</span>
                <ArrowRight />
                <span className={row.byDefault ? "g-s" : "g-t"}>{row.to}</span>
                <span className={`v-map__ok${row.byDefault ? " v-map__ok--default" : ""}`}>
                  {row.byDefault ? <UserRound /> : <Check />}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="v-import__pane" data-pane="done" hidden>
          <div className="v-done">
            <CircleCheck />
            <b>{v.done}</b>
            <span className="v-done__btns">
              <span className="g-btn">{v.again}</span>
              <span className="g-btn g-btn--ink">{v.view}</span>
            </span>
          </div>
        </div>
        <div className="v-import__foot" data-foot>
          <span className="g-s" data-ready hidden>
            <Check />
            {v.ready}
          </span>
          <span className="g-btn g-btn--ink" data-go>
            <LoaderCircle className="v-spin" />
            <span data-go-label>{v.review}</span>
            <ArrowRight />
          </span>
        </div>
      </div>
    </Frame>
  );
}

export function TerminalArt({ v }: { v: V["term"] }) {
  // The last command prints `out`; the closing comment comes after it.
  const lines = [
    ...v.lines.slice(0, -1).map((text) => ({ text, out: false })),
    ...v.out.map((text) => ({ text, out: true })),
    { text: v.lines[v.lines.length - 1], out: false },
  ];
  return (
    <Frame backdrop="dusk" alt={v.alt} scene="terminal">
      <div className="g g--dark term">
        <div className="term__bar">
          <i />
          <i />
          <i />
          <span>{v.title}</span>
        </div>
        <div className="term__body" data-term>
          {lines.map(({ text, out }) =>
            text.startsWith("$ ") ? (
              <div key={text} data-line="cmd">
                <span className="p">$ </span>
                <span data-text>{text.slice(2)}</span>
              </div>
            ) : (
              <div className={out ? "o" : "c"} key={text} data-line={out ? "out" : "note"}>
                {text}
              </div>
            ),
          )}
        </div>
      </div>
    </Frame>
  );
}

// The same three deals in both languages. Fixed text: it shows English and
// Arabic whichever language the page is in.
const BILINGUAL = {
  en: {
    title: "Deals",
    tag: "EN",
    nav: ["Deals", "Contacts", "Insights"],
    deals: [
      { t: "Marwa Clinics · Group plan", v: "$42,000", s: "Proposal made" },
      { t: "Atlas Robotics · Annual plan", v: "$36,000", s: "Demo scheduled" },
      { t: "Northgate Supply · Enterprise", v: "$64,000", s: "Negotiation" },
    ],
  },
  ar: {
    title: "الصفقات",
    tag: "AR",
    nav: ["الصفقات", "جهات الاتصال", "التحليلات"],
    deals: [
      { t: "عيادات مروة · باقة المجموعات", v: "$42,000", s: "تم تقديم العرض" },
      { t: "أطلس للروبوتات · الباقة السنوية", v: "$36,000", s: "عرض مجدول" },
      { t: "نورث غيت للتوريد · المؤسسات", v: "$64,000", s: "تفاوض" },
    ],
  },
} as const;

const TONES: DotTone[] = ["ok", "today", "ok"];
const NAV_ICONS = [LayoutGrid, Users, ChartColumn];

/** Text that exists in both languages: drawn in one, with the other alongside for the scene to swap in. */
function Both({ en, ar, locale }: { en: string; ar: string; locale: Locale }) {
  return (
    <span data-en={en} data-ar={ar}>
      {locale === "ar" ? ar : en}
    </span>
  );
}

export function LanguagesArt({ v, locale }: { v: V["lang"]; locale: Locale }) {
  const { en, ar } = BILINGUAL;
  return (
    <Frame backdrop="mauve" alt={v.alt} scene="languages">
      {/* The still: both languages, side by side. */}
      <div className="g v-lang" data-still>
        {(["en", "ar"] as const).map((lang) => {
          const b = BILINGUAL[lang];
          return (
            <div className="g" key={lang} lang={lang} dir={lang === "ar" ? "rtl" : "ltr"}>
              <div className="g__head">
                <LayoutGrid />
                {b.title}
                <span className="g__end">{b.tag}</span>
              </div>
              <div className="v-lang__list">
                {b.deals.slice(0, 2).map((deal, i) => (
                  <div className="v-deal" key={deal.t}>
                    <div className="v-deal__t">
                      <span className={`dot dot--${TONES[i]}`} />
                      {deal.t}
                    </div>
                    <div className="v-deal__m">
                      <b className="ltr">{deal.v}</b>
                      <span className="g-tag">{deal.s}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {/* What the scene shows instead: one window, with the app's own language
          and theme switches in its top bar. It starts in the page's language. */}
      <div className="g v-app" data-live lang={locale} dir={locale === "ar" ? "rtl" : "ltr"} hidden>
        <div className="v-app__side">
          <div className="v-app__ws" data-flip>
            <BrandMark />
          </div>
          {NAV_ICONS.map((Icon, i) => (
            <div className={`v-app__nav${i === 0 ? " is-on" : ""}`} key={en.nav[i]} data-flip>
              <Icon />
              <Both en={en.nav[i]} ar={ar.nav[i]} locale={locale} />
            </div>
          ))}
        </div>
        <div className="v-app__main">
          <div className="v-app__top">
            <b data-flip>
              <Both en={en.title} ar={ar.title} locale={locale} />
            </b>
            <span className="v-app__sw" data-flip data-switch="lang">
              <Languages />
              {/* The app's button names the language it switches to. */}
              <Both en="ع" ar="EN" locale={locale} />
            </span>
            <span className="v-app__sw" data-flip data-switch="theme">
              <Moon />
              <Sun />
            </span>
          </div>
          <div className="v-app__list">
            {en.deals.map((deal, i) => (
              <div className="v-deal" key={deal.t}>
                <div className="v-deal__t" data-flip>
                  <span className={`dot dot--${TONES[i]}`} />
                  <Both en={deal.t} ar={ar.deals[i].t} locale={locale} />
                </div>
                <div className="v-deal__m">
                  <b className="ltr" data-flip>
                    {deal.v}
                  </b>
                  <span className="g-tag" data-flip>
                    <Both en={deal.s} ar={ar.deals[i].s} locale={locale} />
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Frame>
  );
}
