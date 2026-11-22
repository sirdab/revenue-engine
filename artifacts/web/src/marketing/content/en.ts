// English copy for the marketing pages.
//
// Every claim here describes the product as it is in this repository. Before
// adding a feature to the page, check that it is wired up in the app, not just
// present in the code: the page is the first promise a new user reads.

import type { Content } from "./types";

export const en: Content = {
  common: {
    skip: "Skip to content",
    breadcrumb: "Breadcrumb",
    copy: "Copy",
    copied: "Copied",
    nav: {
      product: "Product",
      openSource: "Open source",
      selfHost: "Self-hosting",
      github: "GitHub",
      signIn: "Sign in",
      start: "Start for free",
      menu: "Menu",
      primary: "Main",
    },
    cta: {
      start: "Start for free",
      github: "View on GitHub",
      star: "Star on GitHub",
      deployGuide: "Read the self-hosting guide",
      source: "Browse the source",
    },
    footer: {
      product: "Product",
      developers: "Developers",
      project: "Project",
      features: "Features",
      deployGuide: "Deploy guide",
      schema: "Database schema",
      contributing: "Contributing",
      security: "Security policy",
      license: "MIT License",
      trademarks: "Trademarks",
      designSystem: "Sirdab One",
      blurb: "The free, open-source CRM for teams that sell.",
      builtBy: "Built by Sirdab",
      rights: "Released under the MIT License.",
      language: "Language",
    },
    home: "Home",
  },

  home: {
    meta: {
      title: "Free open-source CRM for sales teams | Revenue Engine",
      description:
        "Revenue Engine is a free, open-source sales CRM: pipelines, contacts, activities, automations and dashboards. Sign up in seconds or self-host. MIT licensed.",
      imageAlt:
        "The Revenue Engine deal pipeline: a board of deals moving through sales stages.",
    },
    hero: {
      chip: "Open source · MIT licensed",
      title: ["The free, open-source CRM", "for teams that sell."],
      lead: "Pipelines, contacts, activities, automations and dashboards in one fast workspace. Create yours in under a minute, or run it on your own servers.",
      notes: ["No credit card", "No per-seat pricing", "English and Arabic"],
    },
    app: {
      workspace: "Meridian",
      user: "SK",
      menu: "Menu",
      admin: "Administration",
      nav: {
        home: "Home",
        insights: "Insights",
        deals: "Deals",
        contacts: "Contacts",
        activities: "Activities",
        askAi: "Ask AI",
        beta: "beta",
        users: "Users",
        settings: "Settings",
      },
      search: "Search deals, contacts…",
      title: "Deals",
      count: ["12", "deals"],
      views: { pipeline: "Pipeline", list: "List", forecast: "Forecast", funnel: "Funnel" },
      fullPage: "Full page",
      sideDrawer: "Side drawer",
      newDeal: "Deal",
      allPipelines: "Sales pipeline",
      allOwners: "All owners",
      filter: "Filter",
      savedViews: "Views",
      legend: {
        late: "Overdue",
        today: "Due today",
        ok: "Scheduled",
        idle: "No activity scheduled",
      },
      team: [
        { id: "SK", name: "Sara Khan" },
        { id: "LH", name: "Layla Hassan" },
        { id: "MA", name: "Marco Alvarez" },
        { id: "OS", name: "Omar Saleh" },
      ],
      columns: [
        {
          name: "Qualified",
          sum: "$58,400",
          deals: [
            { title: "Lumen Freight · Fleet plan", value: "$18,000", org: "Lumen Freight", who: "SK", age: "2d", tone: "ok", close: "Feb 6", month: 2, last: "2 days ago" },
            { title: "Harbor Clinics · Annual", value: "$34,000", org: "Harbor Clinics", who: "LH", age: "1d", tone: "today", close: "Feb 13", month: 2, last: "Yesterday" },
            { title: "Cedar & Stone · Starter", value: "$6,400", org: "Cedar & Stone", who: "MA", age: "5d", tone: "idle", close: "Feb 20", month: 2, last: "5 days ago" },
          ],
        },
        {
          name: "Contact made",
          sum: "$41,500",
          deals: [
            { title: "Najd Retail Group · Expansion", value: "$29,500", org: "Najd Retail Group", who: "OS", age: "3d", tone: "ok", close: "Feb 27", month: 2, last: "3 days ago" },
          ],
        },
        {
          name: "Demo scheduled",
          sum: "$97,000",
          deals: [
            { title: "Atlas Robotics · Annual plan", value: "$36,000", org: "Atlas Robotics", who: "LH", age: "1d", tone: "ok", close: "Jan 9", month: 1, last: "Yesterday" },
            { title: "Oasis Foods · Multi-site", value: "$52,000", org: "Oasis Foods", who: "OS", age: "6d", tone: "ok", close: "Jan 16", month: 1, last: "6 days ago" },
            { title: "Brightline Studio · Pilot", value: "$9,000", org: "Brightline Studio", who: "MA", age: "4d", tone: "today", close: "Jan 23", month: 1, last: "4 days ago" },
          ],
        },
        {
          name: "Proposal made",
          sum: "$63,200",
          deals: [
            { title: "Marwa Clinics · Group plan", value: "$42,000", org: "Marwa Clinics", who: "SK", age: "0d", tone: "ok", open: true, close: "Dec 12", month: 0, last: "2h ago" },
            { title: "Delta Print Co. · Renewal", value: "$21,200", org: "Delta Print Co.", who: "SK", age: "31d", tone: "late", heat: "hot", close: "Dec 19", month: 0, last: "31 days ago" },
          ],
        },
        {
          name: "Negotiation",
          sum: "$88,000",
          deals: [
            { title: "Northgate Supply · Enterprise", value: "$64,000", org: "Northgate Supply", who: "LH", age: "2d", tone: "ok", close: "Dec 5", month: 0, last: "2 days ago" },
            { title: "Pine & Co · Annual", value: "$24,000", org: "Pine & Co", who: "OS", age: "8d", tone: "today", close: "Dec 22", month: 0, last: "8 days ago" },
          ],
        },
      ],
      held: { title: "Kite Learning · Team plan", value: "$12,000", org: "Kite Learning", who: "SK", age: "16d", tone: "late", heat: "warm", close: "Jan 30", month: 1, last: "16 days ago" },
      drawer: {
        back: "Deals",
        title: "Marwa Clinics · Group plan",
        value: "$42,000",
        owner: "Sara Khan",
        org: "Marwa Clinics",
        stages: ["Qualified", "Contact", "Demo", "Proposal", "Negotiation"],
        stageOn: 3,
        facts: [
          { k: "Probability", v: "60%" },
          { k: "Close date", v: "Dec 12" },
          { k: "Last activity", v: "2h ago" },
        ],
        task: { t: "Send proposal", d: "Task · Lina Haddad", due: "Due tomorrow" },
        note: {
          by: "Omar Saleh",
          when: "2h ago",
          mention: "@Sara",
          text: "pricing is approved for 40 seats. Legal wants the DPA attached.",
        },
        next: "Next activity",
      },
      list: {
        title: "Title",
        org: "Organization",
        value: "Value",
        stage: "Stage",
        owner: "Owner",
        status: "Status",
        open: "Open",
        total: "12 total",
      },
      forecast: {
        open: "Open deals",
        total: "Total value",
        weighted: "Weighted value",
        chart: "Forecast by expected close month",
        months: ["December", "January", "February"],
        legend: ["Total", "Weighted"],
      },
      funnel: {
        pipeline: "Pipeline",
        entered: "Deals entered",
        stages: "Stages",
        chart: "Stage conversion funnel",
        unit: "entered",
      },
      palette: {
        deals: "Deals",
        people: "People",
        none: "No matches",
        person: { name: "Lina Haddad", role: "Marwa Clinics", initials: "LH" },
      },
      hint: "This one is live. Drag a deal, switch the view, open a card.",
      hintTouch: "This one is live. Tap a view to switch it.",
      replay: "Play the tour",
      alt: "Illustration of the Revenue Engine app: a sales pipeline board with deals in five stages, one deal being dragged to the next stage, and a deal open in a side drawer.",
    },
    facts: [
      { n: "$0", l: "per seat, per month" },
      { n: "MIT", l: "licensed, with the source on GitHub" },
      { n: "2", l: "languages: English and Arabic" },
      { n: "1", l: "container to host it yourself" },
    ],
    statement: {
      before: "A complete sales CRM, ",
      em: "without the per-seat bill",
      after: " or a vendor between you and your pipeline.",
    },
    product: {
      eyebrow: "Product",
      title: "Everything between first call and closed-won.",
      lead: "One workspace for deals, people, follow-ups and numbers, so the pipeline stops living in a spreadsheet.",
      jobs: [
        {
          id: "pipeline",
          nav: "Run your pipeline",
          lead: "A board your team will keep current.",
          rest: "Drag deals from stage to stage, see what is going stale, and know the weighted value of what is left to close.",
          caps: [
            { t: "Pipelines your way.", d: "Run several pipelines, each with its own stages, win probabilities and required fields." },
            { t: "Nothing goes quiet.", d: "Every card shows how long it has sat idle, and a deal that outstays its stage's time limit is flagged as rotting." },
            { t: "Four ways to look.", d: "A board, a list, a forecast by close month and a funnel with stage-to-stage conversion." },
          ],
        },
        {
          id: "customers",
          nav: "Know every customer",
          lead: "The whole relationship on one page.",
          rest: "People, organizations, calls, meetings, notes and files, in the order they happened.",
          caps: [
            { t: "One timeline per record.", d: "Activities, notes with @mentions and every field change, with who made it and when." },
            { t: "Find anyone in a keystroke.", d: "Search covers deals, people, organizations, notes and attachments. Phone numbers match however they were typed." },
            { t: "Files stay with the deal.", d: "Attach PDFs, images and Office documents of up to 40 MB to a deal or a note." },
          ],
        },
        {
          id: "automation",
          nav: "Automate the busywork",
          lead: "Rules that take the next step for you.",
          rest: "When a deal is created or changes, Revenue Engine can give it an owner, schedule the follow-up and tell the team.",
          caps: [
            { t: "Leads arrive with an owner.", d: "Assignment rules send new deals to a person, or rotate them through a team in turn." },
            { t: "When this, then that.", d: "Create an activity or a deal, call a webhook, send a Slack message or notify the owner." },
            { t: "Leads from anywhere.", d: "An inbound webhook turns form fills and ad leads into deals, with UTM and click IDs attached." },
          ],
        },
        {
          id: "insights",
          nav: "See what is working",
          lead: "Dashboards you build from your own numbers.",
          rest: "Chart deals and activities the way you think about them, then share the board with the people who need it.",
          caps: [
            { t: "Eight kinds of chart.", d: "Bar, line, area, pie, funnel, KPI, bar list and table, each with its own filters." },
            { t: "Compare and aim.", d: "Set any widget against the previous period, draw a goal line, or keep only the top few." },
            { t: "A head start.", d: "One click builds a starter dashboard of pipeline value, conversion, lost reasons and activity." },
          ],
        },
        {
          id: "ask-ai",
          nav: "Ask your pipeline",
          lead: "Ask a question, see the deals behind the answer.",
          rest: "An optional assistant, powered by Claude, that answers from your live records. It is in beta.",
          caps: [
            { t: "Read-only by design.", d: "It can look records up. It has no way to change one." },
            { t: "Shows its work.", d: "Each answer comes with the deals and records it was drawn from." },
            { t: "Your own key.", d: "It runs on an Anthropic API key, so today it is for self-hosted deployments." },
          ],
        },
      ],
    },
    v: {
      pipeline: {
        cols: ["Demo scheduled", "Proposal made", "Negotiation"],
        deals: [
          { t: "Atlas Robotics", v: "$36,000" },
          { t: "Oasis Foods", v: "$52,000" },
          { t: "Delta Print Co.", v: "$21,200", tag: "31d" },
          { t: "Northgate Supply", v: "$64,000" },
          { t: "Pine & Co", v: "$24,000" },
        ],
        lift: { t: "Marwa Clinics", v: "$42,000" },
        req: {
          title: "Required fields for Proposal made",
          filled: ["2/3 filled", "3/3 filled"],
          fields: [
            { k: "Budget confirmed", v: "Yes" },
            { k: "Decision maker", v: "Lina Haddad" },
            { k: "Expected close date", v: "Dec 12" },
          ],
          cancel: "Cancel",
          wait: "Fill 1 more to move",
          go: "Move deal",
        },
        toast: "Deal moved",
        alt: "Illustration: a deal card dragged to the next pipeline stage, the fields that stage requires before a deal can enter it, and an idle deal flagged in red.",
      },
      customers: {
        name: "Lina Haddad",
        role: "Head of Procurement · Marwa Clinics",
        initials: "LH",
        fields: [
          { k: "Phone", v: "+1 (415) 555-0142" },
          { k: "Email", v: "lina@marwaclinics.example" },
          { k: "Owner", v: "Sara Khan" },
        ],
        label: "Decision maker",
        timeline: "Timeline",
        tabs: ["All", "Activities", "Notes", "History"],
        events: [
          { kind: "call", t: "Discovery call", when: "Today", body: "Replied: wants the proposal by Thursday." },
          { kind: "note", t: "Omar Saleh", when: "Yesterday", mention: "@Sara", body: "pricing is approved for 40 seats." },
          { kind: "file", t: "Proposal-v2.pdf", when: "Mon", body: "Uploaded by Sara Khan" },
          { kind: "stage", t: "Stage changed", when: "Mon", body: "Demo scheduled → Proposal made" },
        ],
        search: {
          placeholder: "Search deals, contacts, activities, notes…",
          people: "People · 1",
          pill: "Contacts",
          person: { q: "415 555 0142", phone: "Phone: +1 (415) 555-0142", org: "Marwa Clinics · Sara Khan" },
          files: "Attachments · 1",
          file: { q: "proposal", name: "Proposal-v2.pdf", mark: "Proposal", deal: "Marwa Clinics · Group plan" },
        },
        alt: "Illustration: a contact record beside a deal's timeline of a call, a note with a mention, a file and a stage change, with a phone-number search finding the contact.",
      },
      automation: {
        nodes: [
          { icon: "trigger", k: "When", t: "Deal updated" },
          { icon: "condition", k: "If", t: "Stage is Proposal made", s: "Value is over $20,000" },
          { icon: "slack", k: "Then", t: "Send Slack message", s: " to #sales" },
        ],
        noMatch: "No match",
        moved: "{deal} moved to Proposal made",
        runs: [
          { deal: "Marwa Clinics · Group plan", value: "$42,000", owner: "Sara Khan", org: "Marwa Clinics", time: "10:42", match: true },
          { deal: "Kite Learning · Team plan", value: "$12,000", owner: "Sara Khan", org: "Kite Learning", time: "11:05", match: false },
          { deal: "Oasis Foods · Multi-site", value: "$52,000", owner: "Omar Saleh", org: "Oasis Foods", time: "11:31", match: true },
        ],
        slack: {
          channel: "#sales",
          app: "Revenue Engine",
          badge: "APP",
          labels: ["Value", "Owner", "Pipeline", "Organization"],
          pipeline: "Sales pipeline",
          open: "Open deal",
          view: "View pipeline",
        },
        rule: {
          title: "Assignment rule",
          when: "New deals in Sales pipeline",
          then: "Round-robin · Inbound team",
          team: ["SK", "MA", "LH", "OS"],
          incoming: ["Lumen Freight · Fleet plan", "Harbor Clinics · Annual", "Cedar & Stone · Starter", "Najd Retail Group · Expansion"],
        },
        alt: "Illustration: an automation that posts to Slack when a deal over $20,000 reaches the proposal stage, the message it sends, and a rule that hands new deals to a team in turn.",
      },
      insights: {
        title: "Overview",
        live: "Live data",
        tiles: [
          { k: "Open pipeline value", v: "$348k", d: "12.5%" },
          { k: "Won value", v: "$70k", d: "27.3%" },
          { k: "Avg deal value", v: "$29k", d: "8.2%" },
        ],
        vs: "vs prev. month",
        chart: {
          title: "Won value by month",
          months: ["Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
          values: [38, 52, 47, 61, 55, 70],
          head: ["Month", "Won value"],
        },
        kinds: {
          title: "Chart type",
          names: { bar: "Bar", list: "Bar list", line: "Line", area: "Area", pie: "Pie", funnel: "Funnel", kpi: "KPI", table: "Table" },
        },
        lost: {
          title: "Lost deals by reason",
          rows: [
            { l: "Price", n: 9 },
            { l: "No budget", n: 6 },
            { l: "Chose a competitor", n: 4 },
            { l: "Timing", n: 3 },
          ],
        },
        alt: "Illustration: a dashboard with open pipeline value, won value and average deal value, a chart of won value by month that can be drawn as any of eight chart types, and lost deals by reason.",
      },
      ai: {
        title: "Ask AI",
        beta: "beta",
        hello: "Good morning, Sara.",
        prompt: "What do you want to know?",
        thinking: "Sweeping through the CRM",
        placeholder: "Ask about a client, a deal owner, a pipeline risk…",
        foot: "Beta · read-only · verify anything important.",
        behind: "Behind this answer",
        railEmpty: "The records behind each answer appear here.",
        related: "Related deals",
        turns: [
          {
            ask: "Which open deals have gone quiet?",
            tools: ["Deal list"],
            answer: "Three open deals have had no activity for more than a week. Delta Print Co. has waited longest, at 31 days.",
            sources: "3 live sources",
            deals: [
              { t: "Delta Print Co. · Renewal", s: "$21,200 · Proposal made · Sara Khan" },
              { t: "Kite Learning · Team plan", s: "$12,000 · Contact made · Sara Khan" },
              { t: "Pine & Co · Annual", s: "$24,000 · Negotiation · Omar Saleh" },
            ],
          },
          {
            ask: "How much is in negotiation?",
            tools: ["Pipeline summary"],
            answer: "Negotiation holds two deals worth $88,000: Northgate Supply at $64,000 and Pine & Co at $24,000.",
            sources: "2 live sources",
            deals: [
              { t: "Northgate Supply · Enterprise", s: "$64,000 · Negotiation · Layla Hassan" },
              { t: "Pine & Co · Annual", s: "$24,000 · Negotiation · Omar Saleh" },
            ],
          },
          {
            ask: "Who owns Atlas Robotics?",
            tools: ["CRM search", "Record context"],
            answer: "Layla Hassan owns Atlas Robotics · Annual plan, a $36,000 deal in Demo scheduled.",
            sources: "1 live source",
            deals: [{ t: "Atlas Robotics · Annual plan", s: "$36,000 · Demo scheduled · Layla Hassan" }],
          },
        ],
        alt: "Illustration: a question to the assistant about quiet deals, its answer, and beside it the deals the answer was drawn from.",
      },
      import: {
        title: "Import deals",
        file: "deals.csv · 1,284 rows",
        steps: ["Type", "Upload", "Map & defaults", "Review", "Done"],
        drop: "Drag a .csv file here",
        noteTitle: "Pipedrive export detected",
        note: "Its columns are matched for you.",
        rows: [
          { from: "Title", to: "Title" },
          { from: "Value", to: "Value" },
          { from: "Currency of Value", to: "Currency" },
          { from: "Expected close date", to: "Expected close date" },
          { from: "Contact person", to: "Person name" },
          { from: "Pipeline", to: "From your import defaults", byDefault: true },
        ],
        review: "Review",
        ready: "1,284 ready to import",
        go: "Import 1,284 deals",
        busy: "Importing…",
        done: "Imported 1,284 deals",
        again: "Import another file",
        view: "View Deals",
        alt: "Illustration: the CSV import with the columns of a Pipedrive export matched to deal fields automatically.",
      },
      term: {
        title: "Try it locally",
        lines: [
          "$ git clone https://github.com/sirdab/revenue-engine.git",
          "$ cd revenue-engine && cp .env.example .env",
          "# set SESSION_SECRET in .env, then",
          "$ docker compose --profile app up -d --build",
          "# open http://localhost:8080 and create a workspace",
        ],
        out: ["[+] Running 5/5", " ✔ Container revenue-engine-app-1  Started"],
        alt: "A terminal with the commands that start Revenue Engine locally with Docker Compose.",
      },
      lang: {
        alt: "Illustration: the same list of deals shown in English, left to right, and in Arabic, right to left.",
      },
    },
    switching: {
      eyebrow: "Switching",
      title: "Bring your data with you.",
      lead: "Import organizations, people and deals from CSV. Columns map themselves, and a Pipedrive export is recognized on sight.",
      ticks: [
        "Headers are matched by name and common aliases",
        "Large files go in as batches of 5,000 rows",
        "Each batch saves completely or not at all",
      ],
      link: "Moving from Pipedrive",
    },
    openSource: {
      eyebrow: "Open source",
      title: "Own your CRM. Read every line.",
      lead: "Revenue Engine is MIT licensed and built in the open. Use our hosted version, or run the same code on your own servers with one container and a PostgreSQL database.",
      ticks: [
        "One codebase, with no paid edition",
        "One Docker image for the API and the web app",
        "Migrations in the repository, run on every deploy",
      ],
      cards: [
        {
          t: "Isolated by the database",
          d: "Every workspace is kept apart by PostgreSQL row-level security, applied to each query by the database itself.",
        },
        {
          t: "One container",
          d: "The server is stateless. Add machines when you need them; everything they share lives in PostgreSQL.",
        },
        {
          t: "Typed end to end",
          d: "TypeScript throughout, with an OpenAPI contract that generates the validation and the client.",
        },
      ],
    },
    languages: {
      eyebrow: "Languages",
      title: "At home in English and Arabic.",
      lead: "Each person picks their own language. In Arabic the whole layout mirrors: navigation, boards, tables and forms.",
      ticks: [
        "Right-to-left layout, not just translated words",
        "The choice follows you across devices",
        "Light and dark themes in both",
      ],
    },
    integrations: {
      eyebrow: "Integrations",
      title: "Fits the tools around it.",
      lead: "Revenue Engine keeps the pipeline and talks to everything else through Slack and webhooks.",
      cards: [
        {
          icon: "slack",
          t: "Slack",
          d: "Post to a channel or message the deal's owner from any automation, with the deal's details filled in.",
        },
        {
          icon: "in",
          t: "Inbound webhooks",
          d: "Create and update deals from forms, ads and scripts, authenticated with a secret that belongs to your workspace.",
        },
        {
          icon: "out",
          t: "Outbound webhooks",
          d: "Call any HTTPS endpoint when a deal matches your conditions, with the deal attached.",
        },
      ],
    },
    pricing: {
      eyebrow: "Pricing",
      title: "Free to use. Free to run.",
      lead: "No plans to compare and no seats to count.",
      plans: [
        {
          name: "Cloud",
          sub: "Hosted by Sirdab",
          price: "$0",
          per: "per user",
          ticks: [
            "A private workspace, ready in under a minute",
            "Pipelines, contacts, automations and insights",
            "No credit card and no per-seat pricing",
          ],
          cta: "Start for free",
        },
        {
          name: "Self-hosted",
          sub: "On your own servers",
          price: "$0",
          per: "MIT licensed",
          ticks: [
            "Your infrastructure, your database, your backups",
            "One Docker image and a PostgreSQL database",
            "Ask AI with your own Anthropic key",
          ],
          cta: "Read the self-hosting guide",
        },
      ],
    },
    faq: {
      eyebrow: "Questions",
      title: "Asked before signing up.",
      lead: "Something else? Open an issue on [GitHub](github).",
      items: [
        {
          q: "Is Revenue Engine really free?",
          a: [
            "Yes. The hosted version is free to use and has no per-seat pricing. The source code is MIT licensed, so you can also run it yourself and pay only for your own servers.",
          ],
        },
        {
          q: "What does open source mean here?",
          a: [
            "The complete application is published on [GitHub](github) under the [MIT License](license): the API, the web app, the database schema and the migrations. You can read it, run it, change it and build on it.",
            "The Sirdab name and logos are trademarks and are not covered by the license.",
          ],
        },
        {
          q: "Can I host it myself?",
          a: [
            "Yes. It ships as one Docker image that serves the API and the web app, and it needs a PostgreSQL 13+ database. Email, file storage and the AI assistant are optional. The [self-hosting guide](self-hosted-crm) has the details.",
          ],
        },
        {
          q: "How is my data kept apart from other workspaces?",
          a: [
            "Every row belongs to a workspace, and PostgreSQL row-level security filters each query to the workspace of the person signed in. The rule is enforced by the database, so isolation does not depend on every query in the application remembering a filter.",
          ],
        },
        {
          q: "Can I move from Pipedrive or a spreadsheet?",
          a: [
            "Yes. A workspace admin can import organizations, people and deals from CSV files. Columns are matched automatically, and exports from Pipedrive are recognized. Imports create new records; they do not update or merge existing ones. See [moving from Pipedrive](pipedrive-alternative).",
          ],
        },
        {
          q: "Does it support Arabic?",
          a: [
            "Yes. The app is available in English and Arabic with a mirrored right-to-left layout, and each person chooses their own language. A few administrator setup screens are still in English only.",
          ],
        },
        {
          q: "What can the AI assistant do?",
          a: [
            "Ask AI is an optional assistant in beta. It answers questions about your pipeline using a fixed set of lookups and cannot change records. It uses the Claude API and needs an Anthropic API key, so today it is available on self-hosted deployments.",
          ],
        },
        {
          q: "What does it not do?",
          a: [
            "Revenue Engine is about the pipeline. It does not sync your email inbox or calendar, send email sequences, or produce quotes and invoices, and there is no native mobile app: it is a responsive web app. It connects to other tools through Slack and webhooks.",
          ],
        },
        {
          q: "Who is behind it?",
          a: [
            "Revenue Engine is built and maintained by [Sirdab](company) and developed in the open. Bug reports and pull requests are welcome.",
          ],
        },
      ],
    },
    closer: {
      title: "Put your pipeline to work.",
      lead: "Create a workspace in under a minute. Bring the team in when you are ready.",
    },
  },

  guides: {
    "open-source-crm": {
      meta: {
        title: "Open-source CRM, MIT licensed and free | Revenue Engine",
        description:
          "An open-source CRM you can read, run and change: pipelines, contacts, automations and dashboards under the MIT license. Use it hosted for free, or self-host.",
        imageAlt: "Revenue Engine, an open-source CRM under the MIT license.",
      },
      name: "Open-source CRM",
      eyebrow: "Open source",
      h1: "An open-source CRM you can read, run and change.",
      lead: "Revenue Engine is a complete sales CRM published under the MIT license. Use the hosted version for free, or run the same code on your own servers.",
      sections: [
        {
          id: "what-you-get",
          nav: "What you get",
          title: "A full sales CRM, in the open.",
          blocks: [
            {
              kind: "p",
              text: [
                "Revenue Engine is a focused tool for running a sales pipeline. It does a small number of things thoroughly, and all of it is on [GitHub](github).",
              ],
            },
            {
              kind: "bullets",
              items: [
                "**Pipelines and deals.** A drag-and-drop board, several pipelines, win probabilities, required fields per stage, won and lost reasons, merge, archive and restore.",
                "**People and organizations.** Linked to deals, with activities, rich-text notes, @mentions and file attachments.",
                "**Automation.** Assignment rules, and automations that create activities and deals, call webhooks, send Slack messages and notify people.",
                "**Insights.** Dashboards built from eight chart types over your deals and activities.",
                "**Search and import.** Global search, phone numbers included, and a guided CSV import that recognizes Pipedrive exports.",
                "**Workspaces.** Self-serve sign-up, admin and member roles, teams, and a history of every change.",
                "**English and Arabic**, with a right-to-left layout.",
              ],
            },
          ],
        },
        {
          id: "license",
          nav: "The license",
          title: "MIT, with no paid edition.",
          blocks: [
            {
              kind: "p",
              text: [
                "The whole application is released under the [MIT License](license): the API, the web app, the database schema and the migrations. You may use it commercially, modify it, and host it for other people.",
                "There is one codebase. It has no enterprise edition and no features held back behind a license key.",
              ],
            },
            {
              kind: "callout",
              tone: "info",
              text: "The Sirdab name and logos are trademarks and are not covered by the MIT License. If you distribute a fork or host it for others, use your own name and marks. See [TRADEMARKS.md](trademarks).",
            },
          ],
        },
        {
          id: "stack",
          nav: "Under the hood",
          title: "Built from proven parts.",
          blocks: [
            {
              kind: "table",
              head: ["Layer", "What it is"],
              rows: [
                ["Language", "TypeScript, end to end"],
                ["Server", "Node.js 24 with Express 5"],
                ["Database", "PostgreSQL 13+ with Drizzle ORM and committed SQL migrations"],
                ["Web app", "React 19, Vite and Tailwind CSS on the [Sirdab One](one) design system"],
                ["API contract", "OpenAPI, with generated validation schemas and React Query hooks"],
                ["Packaging", "One Docker image that serves the API and the web app"],
              ],
            },
            {
              kind: "p",
              text: [
                "The repository is a pnpm workspace. Shared libraries hold the database schema, the API contract and the deal filter language that the server and the browser both use.",
              ],
            },
          ],
        },
        {
          id: "isolation",
          nav: "Tenant isolation",
          title: "Workspaces are separated by the database.",
          blocks: [
            {
              kind: "p",
              text: [
                "Revenue Engine is multi-tenant: one deployment serves many workspaces. Each row carries the ID of the workspace it belongs to, and PostgreSQL row-level security filters every query to the workspace of the person signed in.",
                "The policy is forced, so it applies even to the database role that owns the tables. A query that forgets its filter still returns nothing from another workspace, because the database never offers those rows.",
                "Passwords are hashed with scrypt. Sessions are signed cookies, and changing a password ends every session issued before it. Sign-in, sign-up and password-reset requests are rate limited.",
              ],
            },
          ],
        },
        {
          id: "contributing",
          nav: "Contributing",
          title: "Built in the open.",
          blocks: [
            {
              kind: "p",
              text: [
                "Development happens on [GitHub](github). Bug reports, fixes, translations and features are welcome: [CONTRIBUTING.md](contributing) explains how to set up, and [SECURITY.md](security) explains how to report a vulnerability privately.",
              ],
            },
            {
              kind: "code",
              label: "Run it locally",
              code: [
                "git clone https://github.com/sirdab/revenue-engine.git",
                "cd revenue-engine",
                "pnpm install",
                "cp .env.example .env    # then set SESSION_SECRET",
                "pnpm db:setup           # Postgres, storage and mail in Docker, plus demo data",
                "pnpm dev                # http://localhost:3210",
              ].join("\n"),
            },
            { kind: "fine", text: "You need Node 24, pnpm 10 and Docker." },
          ],
        },
      ],
      faqTitle: "Open-source questions.",
      faq: [
        {
          q: "Is it free for commercial use?",
          a: ["Yes. The MIT License permits commercial use, modification and redistribution."],
        },
        {
          q: "Do I have to host it myself?",
          a: ["No. You can use the hosted version for free, host it yourself, or do both."],
        },
        {
          q: "How do I report a security problem?",
          a: [
            "Privately, through the repository's Security tab on GitHub, as described in [SECURITY.md](security). Please do not open a public issue.",
          ],
        },
      ],
    },

    "pipedrive-alternative": {
      meta: {
        title: "Open-source Pipedrive alternative, free | Revenue Engine",
        description:
          "A free, open-source alternative to Pipedrive: the same pipeline-first way of selling, MIT licensed, with an import that reads Pipedrive exports.",
        imageAlt: "Revenue Engine, an open-source alternative to Pipedrive.",
      },
      name: "Pipedrive alternative",
      eyebrow: "Compare",
      h1: "The open-source alternative to Pipedrive.",
      lead: "If your team thinks in pipelines, stages and next activities, Revenue Engine will feel familiar. The difference is that it is free, MIT licensed, and yours to host.",
      sections: [
        {
          id: "familiar",
          nav: "What is familiar",
          title: "The same way of working.",
          blocks: [
            {
              kind: "p",
              text: [
                "Revenue Engine was built in the spirit of Pipedrive. The deal board is the home screen, every deal should have a next activity, and deals that sit still get flagged.",
              ],
            },
            {
              kind: "bullets",
              items: [
                "**Pipelines and stages**, with win probabilities and a weighted forecast.",
                "**Rotting deals.** Set a number of days for a stage, and deals that sit past it stand out.",
                "**Activities** for calls, meetings, emails, tasks and deadlines, colored by what is overdue, due today or scheduled.",
                "**Won and lost** in one click, with lost reasons you define.",
                "**Custom fields**, filters and saved views on the deal list.",
              ],
            },
          ],
        },
        {
          id: "differences",
          nav: "What is different",
          title: "Where the two part ways.",
          blocks: [
            {
              kind: "table",
              head: ["", "Revenue Engine", "Pipedrive"],
              rows: [
                ["Price", "yes:Free", "Paid plans, with a 14-day trial"],
                ["Source code", "yes:Open source, MIT", "no:Proprietary"],
                ["Host it yourself", "yes:One Docker image", "no:Cloud only"],
                ["Email inbox sync", "no:Not available", "yes:Yes"],
                ["Mobile apps", "part:Responsive web app", "yes:iOS and Android"],
                ["Integrations", "part:Slack and webhooks", "yes:Marketplace of 500+ tools"],
              ],
            },
            {
              kind: "p",
              text: [
                "Pipedrive is a mature product with far more surface area. If you depend on its email sync, mobile apps or marketplace, it is the better choice today. If you want a pipeline tool you can own, read and run for free, that is what Revenue Engine is for.",
              ],
            },
            {
              kind: "fine",
              text: "Pipedrive details are taken from pipedrive.com, November 2026. Pipedrive is a trademark of its owner. Revenue Engine is not affiliated with or endorsed by Pipedrive.",
            },
          ],
        },
        {
          id: "import",
          nav: "Moving your data",
          title: "Move your data in three steps.",
          blocks: [
            {
              kind: "steps",
              items: [
                {
                  t: "Export from Pipedrive",
                  d: "Export your organizations, people and deals from Pipedrive's list views as CSV files.",
                },
                {
                  t: "Upload each file",
                  d: "In Revenue Engine, an admin opens Import and uploads the file. A Pipedrive export is recognized and its columns are mapped automatically.",
                },
                {
                  t: "Choose the defaults",
                  d: "Pick the pipeline, stage and owner the imported records should get. Pipedrive's own IDs are never used to link records, so nothing attaches to the wrong one.",
                },
              ],
            },
            {
              kind: "callout",
              tone: "info",
              text: "Imports create new records; they never update or merge existing ones. Activities, notes and files are not imported.",
            },
          ],
        },
      ],
      faqTitle: "Switching questions.",
      faq: [
        {
          q: "Is Revenue Engine affiliated with Pipedrive?",
          a: ["No. It is an independent open-source project built by Sirdab."],
        },
        {
          q: "Can I try it before moving anything?",
          a: [
            "Yes. Create a free workspace, import a small file, and see how your pipeline looks before you decide.",
          ],
        },
        {
          q: "How large a file can I import?",
          a: [
            "There is no overall limit. Files are sent in batches of 5,000 rows, and each batch is saved completely or not at all.",
          ],
        },
      ],
    },

    "self-hosted-crm": {
      meta: {
        title: "Self-hosted CRM in one Docker container | Revenue Engine",
        description:
          "Run Revenue Engine, a free open-source CRM, on your own servers: one Docker image and a PostgreSQL database, with optional SMTP and S3 storage. MIT licensed.",
        imageAlt: "Revenue Engine, a self-hosted CRM in one Docker container.",
      },
      name: "Self-hosted CRM",
      eyebrow: "Self-hosting",
      h1: "A self-hosted CRM in one container.",
      lead: "Revenue Engine ships as a single Docker image that serves the API and the web app. Point it at a PostgreSQL database and you have a private CRM.",
      sections: [
        {
          id: "requirements",
          nav: "What you need",
          title: "What you need.",
          blocks: [
            {
              kind: "bullets",
              items: [
                "**PostgreSQL 13 or newer**, reached as an ordinary database role (see below).",
                "**A container host**: Fly.io, a virtual server, Kubernetes or anything else that runs a Docker image. The image is built for linux/amd64.",
                "**HTTPS** in front of the app. The session cookie is marked Secure.",
                "Optionally, **SMTP** for email, **S3-compatible storage** for attachments, and an **Anthropic API key** for Ask AI.",
              ],
            },
          ],
        },
        {
          id: "try-it",
          nav: "Try it locally",
          title: "Try it on your machine.",
          blocks: [
            {
              kind: "code",
              label: "Docker Compose",
              code: [
                "git clone https://github.com/sirdab/revenue-engine.git",
                "cd revenue-engine",
                "cp .env.example .env    # then set SESSION_SECRET (openssl rand -hex 32)",
                "docker compose --profile app up -d --build",
                "# open http://localhost:8080 and create a workspace",
              ].join("\n"),
            },
            {
              kind: "callout",
              tone: "warn",
              text: "This Compose profile is a try-out, not a deployment: mail goes to a local inbox with no login, and files are stored with default credentials. On Apple silicon, build the image on an amd64 machine or run `pnpm dev` instead.",
            },
          ],
        },
        {
          id: "database",
          nav: "The database rule",
          title: "The one database rule.",
          blocks: [
            {
              kind: "p",
              text: [
                "Workspaces are kept apart by PostgreSQL row-level security. Superusers and roles with `BYPASSRLS` skip it entirely, so the app must connect as an ordinary role. The admin user of a managed database is often not one.",
              ],
            },
            {
              kind: "code",
              label: "SQL, as your database admin",
              code: [
                "CREATE ROLE crm_app LOGIN PASSWORD '<long random password>' NOSUPERUSER NOBYPASSRLS;",
                "GRANT crm_app TO CURRENT_USER;",
                "CREATE DATABASE crm OWNER crm_app;",
              ].join("\n"),
            },
            {
              kind: "callout",
              tone: "warn",
              text: "**Connect to PostgreSQL directly**, not through a transaction-mode pooler such as PgBouncer. The app marks each connection with its workspace for the length of a session, and transaction pooling does not preserve that.",
            },
          ],
        },
        {
          id: "run",
          nav: "Run it",
          title: "Run it.",
          blocks: [
            {
              kind: "code",
              label: "Any container host",
              code: [
                "docker build -t revenue-engine .",
                "docker run -p 8080:8080 --env-file .env revenue-engine \\",
                '  sh -c "node dist/migrate.mjs && exec node --enable-source-maps dist/index.mjs"',
              ].join("\n"),
            },
            {
              kind: "p",
              text: [
                "The migrations are inside the image and are safe to run on every start. Several containers can serve at once, because all state lives in PostgreSQL.",
              ],
            },
            {
              kind: "table",
              head: ["Variable", "What it is for"],
              rows: [
                ["`DATABASE_URL`", "Required. Connection string for the ordinary database role."],
                ["`SESSION_SECRET`", "Required. A long random string that signs the session cookie."],
                ["`PORT`", "Required. The port the server listens on; the image expects 8080."],
                ["`APP_BASE_URL`", "The public URL, used in emails, Slack messages, canonical links and the sitemap."],
                ["`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`", "Optional. Email for password resets and notifications."],
                ["`S3_ENDPOINT`, `S3_BUCKET_NAME`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`", "Optional. S3-compatible storage for attachments."],
                ["`ANTHROPIC_API_KEY`", "Optional. Turns on Ask AI."],
              ],
            },
          ],
        },
        {
          id: "fly",
          nav: "Deploy on Fly.io",
          title: "Deploy on Fly.io.",
          blocks: [
            {
              kind: "steps",
              items: [
                {
                  t: "Create the database",
                  d: "Create a Managed Postgres cluster, then a database and a user for the app. Use the cluster's direct address, not the pooled one.",
                },
                {
                  t: "Create the app and its secrets",
                  d: "Set `DATABASE_URL`, `SESSION_SECRET` and `APP_BASE_URL` with `fly secrets set`.",
                },
                {
                  t: "Deploy",
                  d: "`fly deploy --remote-only` builds the image and runs the migrations as a release command before any machine is updated.",
                },
              ],
            },
            {
              kind: "p",
              text: ["Every command, in order, is in [DEPLOY.md](deploy)."],
            },
          ],
        },
        {
          id: "checklist",
          nav: "Before going live",
          title: "Before you go live.",
          blocks: [
            {
              kind: "bullets",
              items: [
                "The database role is not a superuser and does not have `BYPASSRLS`.",
                "`SESSION_SECRET` is long, random and different in every environment.",
                "HTTPS is in front of the app, and `APP_BASE_URL` is its public URL.",
                "Database backups are switched on.",
                "The demo seed never runs against a real database: it deletes every workspace.",
              ],
            },
          ],
        },
      ],
      faqTitle: "Self-hosting questions.",
      faq: [
        {
          q: "What does it cost to run?",
          a: ["The software is free. You pay only for the server and the database you run it on."],
        },
        {
          q: "Does it scale past one server?",
          a: [
            "Yes. The server holds no state of its own: run several containers behind a load balancer and they share one database.",
          ],
        },
        {
          q: "How do upgrades work?",
          a: [
            "Pull the new image and start it. The migrations run first and skip whatever is already applied.",
          ],
        },
        {
          q: "Can I use a managed PostgreSQL service?",
          a: [
            "Yes. Create the application role as shown above, and connect directly rather than through a transaction-mode pooler.",
          ],
        },
      ],
    },
  },

  llms: {
    summary:
      "Revenue Engine is a free, open-source (MIT) multi-tenant sales CRM built by Sirdab. Teams sign up and get an isolated workspace, or self-host the same code with one Docker image and PostgreSQL.",
    facts: [
      "Deal pipelines on a drag-and-drop board, with list, forecast and funnel views, win probabilities, rotting deals, required fields per stage, and won/lost reasons.",
      "People and organizations with activities (call, meeting, email, task, deadline, WhatsApp), rich-text notes with @mentions, and file attachments.",
      "Assignment rules (fixed owner or team rotation) and automations triggered when a deal is created or updated: create activity, create deal, call webhook, send Slack message, post notification.",
      "Insights dashboards over deals and activities: bar, bar list, line, area, pie, funnel, KPI and table widgets.",
      "Global search across deals, people, organizations, activities, notes and attachments, including formatting-insensitive phone search.",
      "CSV import of organizations, people and deals, with automatic column mapping and recognition of Pipedrive exports. Imports are create-only.",
      "Inbound webhooks for leads and deal updates, authenticated with a per-workspace secret.",
      "English and Arabic interface with right-to-left layout; light and dark themes.",
      "Tenant isolation by PostgreSQL row-level security. Passwords hashed with scrypt.",
      "Optional read-only AI assistant (beta) using the Claude API; requires an Anthropic API key.",
      "Stack: TypeScript, Node.js 24, Express 5, PostgreSQL 13+, Drizzle ORM, React 19, Vite, OpenAPI.",
    ],
    notYet:
      "Not included: email inbox or calendar sync, email sequences, quotes and invoices, native mobile apps, single sign-on, public API keys.",
  },
};
