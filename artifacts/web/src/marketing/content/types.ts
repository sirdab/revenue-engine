// The shape of the marketing copy. `en.ts` and `ar.ts` both satisfy `Content`,
// so a string added to one language and forgotten in the other fails the
// typecheck rather than rendering as a blank.
//
// Inline markup in any string marked "rich" below (see components/rich.tsx):
//   **strong**   [label](url)   `code`
// A link target may be a URL, a page id (`self-hosted-crm`), or one of the
// short names rich.tsx knows (`github`, `license`, `deploy`, ...).

import type { PageId } from "../site";

/** How a deal's next activity stands; the colour of its dot. */
export type DotTone = "late" | "today" | "ok" | "idle";

export interface BoardDeal {
  title: string;
  value: string;
  org: string;
  who: string;
  age: string;
  tone: DotTone;
  /** Idle long enough to be flagged: amber, then red. */
  heat?: "warm" | "hot";
  /** The deal shown in the side drawer. */
  open?: boolean;
  /** Expected close date, as the drawer and the list show it. */
  close: string;
  /** Which of the forecast's three months that date falls in. */
  month: 0 | 1 | 2;
  /** When it was last touched, in words. */
  last: string;
}

export interface BoardColumn {
  name: string;
  sum: string;
  deals: BoardDeal[];
}

export interface Meta {
  /** <title>: about 50–60 characters, the search phrase first. */
  title: string;
  /** Meta description: about 150 characters. */
  description: string;
  /** Alt text of the share image. */
  imageAlt: string;
}

export interface Faq {
  q: string;
  /** Rich. One string per paragraph. */
  a: string[];
}

export type Block =
  | { kind: "p"; text: string[] }
  | { kind: "bullets"; items: string[] }
  | { kind: "steps"; items: { t: string; d: string }[] }
  /** Lines starting with `#` render as comments. Always left-to-right. */
  | { kind: "code"; label: string; code: string }
  /**
   * The first column is the row heading. A cell may start with `yes:`, `no:`
   * or `part:` to carry a tick, a dash or a half mark.
   */
  | { kind: "table"; head: string[]; rows: string[][] }
  | { kind: "callout"; tone: "info" | "warn"; text: string }
  | { kind: "fine"; text: string };

export interface GuideSection {
  id: string;
  /** Short label in the page's table of contents. */
  nav: string;
  title: string;
  blocks: Block[];
}

export interface Guide {
  meta: Meta;
  /** Name in breadcrumbs, the footer and the sitemap. */
  name: string;
  eyebrow: string;
  h1: string;
  lead: string;
  sections: GuideSection[];
  faqTitle: string;
  faq: Faq[];
}

export interface Job {
  id: string;
  /** In the sticky list beside the product section. */
  nav: string;
  /** Headline: the lead reads in ink, the rest in grey. */
  lead: string;
  rest: string;
  caps: { t: string; d: string }[];
}

export interface Content {
  common: {
    skip: string;
    breadcrumb: string;
    copy: string;
    copied: string;
    nav: {
      product: string;
      openSource: string;
      selfHost: string;
      github: string;
      signIn: string;
      start: string;
      menu: string;
      primary: string;
    };
    cta: { start: string; github: string; star: string; deployGuide: string; source: string };
    footer: {
      product: string;
      developers: string;
      project: string;
      features: string;
      deployGuide: string;
      schema: string;
      contributing: string;
      security: string;
      license: string;
      trademarks: string;
      designSystem: string;
      blurb: string;
      builtBy: string;
      rights: string;
      language: string;
    };
    home: string;
  };

  home: {
    meta: Meta;
    hero: {
      chip: string;
      /** Two lines; the break falls between them on wide screens. */
      title: [string, string];
      lead: string;
      notes: string[];
    };
    /** The product window in the hero. */
    app: {
      workspace: string;
      user: string;
      menu: string;
      admin: string;
      nav: {
        home: string;
        insights: string;
        deals: string;
        contacts: string;
        activities: string;
        askAi: string;
        beta: string;
        users: string;
        settings: string;
      };
      search: string;
      title: string;
      count: [string, string];
      views: { pipeline: string; list: string; forecast: string; funnel: string };
      fullPage: string;
      sideDrawer: string;
      newDeal: string;
      allPipelines: string;
      allOwners: string;
      filter: string;
      savedViews: string;
      legend: { late: string; today: string; ok: string; idle: string };
      /** The people who own deals. `id` is the initials on a card. */
      team: { id: string; name: string }[];
      columns: BoardColumn[];
      /** The card being dragged from the second column to the third. */
      held: BoardDeal;
      drawer: {
        back: string;
        title: string;
        value: string;
        owner: string;
        org: string;
        stages: string[];
        stageOn: number;
        facts: { k: string; v: string }[];
        task: { t: string; d: string; due: string };
        note: { by: string; when: string; mention: string; text: string };
        /** Label of the next-activity line on a deal that has no task drawn. */
        next: string;
      };
      /** The list view: column headings, the status pill and the row count. */
      list: { title: string; org: string; value: string; stage: string; owner: string; status: string; open: string; total: string };
      /** The forecast view. `months` are the three close months, soonest first. */
      forecast: {
        open: string;
        total: string;
        weighted: string;
        chart: string;
        months: [string, string, string];
        legend: [string, string];
      };
      /** The funnel view. `unit` follows a count: "64 entered". */
      funnel: { pipeline: string; entered: string; stages: string; chart: string; unit: string };
      /** The search palette. `person` is the one contact it can find. */
      palette: { deals: string; people: string; none: string; person: { name: string; role: string; initials: string } };
      /** Under the window: that it can be used, and the button that restarts the tour. */
      hint: string;
      hintTouch: string;
      replay: string;
      alt: string;
    };
    facts: { n: string; l: string }[];
    statement: { before: string; em: string; after: string };
    product: {
      eyebrow: string;
      title: string;
      lead: string;
      jobs: Job[];
    };
    /**
     * The product illustrations. Each is drawn as a still, and client/scenes.ts
     * then plays it: what a scene needs beyond the still (the next message, the
     * other answers) is here too, and reaches the script through the markup.
     */
    v: {
      pipeline: {
        /** Three stages. Their counts and totals are added up from the cards. */
        cols: [string, string, string];
        /** Two cards in the first stage, one in the second, two in the third. */
        deals: { t: string; v: string; tag?: string }[];
        /** The card that is moved from the first stage to the second. */
        lift: { t: string; v: string };
        /** The dialog that stops the move until the stage's fields are filled. */
        req: {
          title: string;
          /** "2/3 filled", then "3/3 filled". */
          filled: [string, string];
          /** The last one is empty until the scene fills it. */
          fields: { k: string; v: string }[];
          cancel: string;
          /** The button while a field is missing, and once none is. */
          wait: string;
          go: string;
        };
        toast: string;
        alt: string;
      };
      customers: {
        name: string;
        role: string;
        initials: string;
        fields: { k: string; v: string }[];
        label: string;
        timeline: string;
        /** All, Activities, Notes, History. */
        tabs: [string, string, string, string];
        events: { kind: "call" | "note" | "file" | "stage"; t: string; when: string; body: string; mention?: string }[];
        search: {
          placeholder: string;
          /** Where the person was found, and the pill beside their name. */
          people: string;
          pill: string;
          /** `phone` is the label before the number; `org` follows it. */
          person: { q: string; phone: string; org: string };
          /** A second search: a word from a file name, found among attachments. */
          files: string;
          file: { q: string; name: string; mark: string; deal: string };
        };
        alt: string;
      };
      automation: {
        /** One automation: its trigger, its two conditions and its single action. */
        nodes: { icon: "trigger" | "condition" | "slack"; k: string; t: string; s?: string }[];
        /** Shown on the condition when a deal does not meet it. */
        noMatch: string;
        /** `{deal}` is replaced by the deal's title. */
        moved: string;
        /** Deals that reach the stage, one after another. `match`: over the value in the condition. */
        runs: { deal: string; value: string; owner: string; org: string; time: string; match: boolean }[];
        slack: {
          channel: string;
          app: string;
          badge: string;
          /** Value, Owner, Pipeline, Organization. */
          labels: [string, string, string, string];
          pipeline: string;
          open: string;
          view: string;
        };
        /** `team` is the initials of the four people in the rotation. */
        rule: { title: string; when: string; then: string; team: [string, string, string, string]; incoming: string[] };
        alt: string;
      };
      insights: {
        title: string;
        live: string;
        /** `d` is the change on the previous month, unsigned: "12.5%". */
        tiles: { k: string; v: string; d: string }[];
        vs: string;
        chart: {
          title: string;
          months: [string, string, string, string, string, string];
          /** Thousands of dollars won in each of those months. */
          values: [number, number, number, number, number, number];
          /** The table's two headings. */
          head: [string, string];
        };
        /** The chart-type picker, in the app's order. */
        kinds: {
          title: string;
          names: { bar: string; list: string; line: string; area: string; pie: string; funnel: string; kpi: string; table: string };
        };
        lost: { title: string; rows: { l: string; n: number }[] };
        alt: string;
      };
      ai: {
        title: string;
        beta: string;
        /** The empty chat: a greeting, and the question under it. */
        hello: string;
        prompt: string;
        /** Shown while it looks things up, before the first tool is named. */
        thinking: string;
        placeholder: string;
        foot: string;
        behind: string;
        /** In the side panel before there is an answer. */
        railEmpty: string;
        related: string;
        /** `s` under a deal is "value · stage · owner". */
        turns: { ask: string; tools: string[]; answer: string; sources: string; deals: { t: string; s: string }[] }[];
        alt: string;
      };
      import: {
        title: string;
        file: string;
        /** Type, Upload, Map & defaults, Review, Done. */
        steps: [string, string, string, string, string];
        drop: string;
        noteTitle: string;
        note: string;
        rows: { from: string; to: string; byDefault?: boolean }[];
        review: string;
        ready: string;
        go: string;
        busy: string;
        done: string;
        again: string;
        view: string;
        alt: string;
      };
      /** `out` is what the last command prints. */
      term: { title: string; lines: string[]; out: string[]; alt: string };
      lang: { alt: string };
    };
    switching: { eyebrow: string; title: string; lead: string; ticks: string[]; link: string };
    openSource: {
      eyebrow: string;
      title: string;
      lead: string;
      ticks: string[];
      cards: { t: string; d: string }[];
    };
    languages: { eyebrow: string; title: string; lead: string; ticks: string[] };
    integrations: {
      eyebrow: string;
      title: string;
      lead: string;
      cards: { icon: "slack" | "in" | "out" | "zap"; t: string; d: string }[];
    };
    pricing: {
      eyebrow: string;
      title: string;
      lead: string;
      plans: {
        name: string;
        sub: string;
        price: string;
        per: string;
        ticks: string[];
        cta: string;
      }[];
    };
    faq: { eyebrow: string; title: string; lead: string; items: Faq[] };
    closer: { title: string; lead: string };
  };

  guides: Record<Exclude<PageId, "home">, Guide>;

  /** Plain-text summary for llms.txt. */
  llms: { summary: string; facts: string[]; notYet: string };
}
