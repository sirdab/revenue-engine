// The "free CRM" page. Search phrase: "Free CRM" / «برنامج CRM مجاني».
//
// Free means two different things here and the page keeps them apart: the
// open-source version is free for as long as you run it yourself, and the
// hosted version is free for its first 3 months only. Prices match
// HOSTED_PRICE in ../../site.ts and `home.pricing`; change them together.

import type { Guide } from "../types";

export const freeCrm: { en: Guide; ar: Guide } = {
  en: {
    meta: {
      title: "Free CRM: self-host it, or 3 months hosted | Revenue Engine",
      description:
        "A free CRM two honest ways: self-host the open-source version free forever, or use the hosted version free for 3 months, then SAR 24.91 per seat a month.",
      imageAlt: "Revenue Engine, a free open-source CRM for sales teams.",
    },
    name: "Free CRM",
    eyebrow: "Pricing",
    h1: "A free CRM, with no catch in the small print.",
    lead: "Revenue Engine is a free CRM in two ways: the open-source version costs nothing to run on your own servers, for as long as you run it, and the hosted version is free for the first 3 months.",
    sections: [
      {
        id: "two-ways",
        nav: "Two ways it is free",
        title: "Two ways to use a free CRM.",
        blocks: [
          {
            kind: "p",
            text: [
              "Most free CRM plans are a trial or a cut-down edition. Revenue Engine has one codebase with no paid edition, so both options below run the same application, with the same pipelines, contacts, automations and dashboards.",
              "What differs is who runs it, and for how long it costs nothing.",
            ],
          },
          {
            kind: "table",
            head: ["", "Self-hosted (open source)", "Hosted by Sirdab"],
            rows: [
              ["Cost", "yes:Free, for as long as you run it. You pay only for your own server and database", "part:Free for the first 3 months, then SAR 24.91 per seat a month, billed annually (SAR 299 per seat a year)"],
              ["Who runs it", "You, on infrastructure you choose", "Sirdab"],
              ["Setup", "One Docker image and a PostgreSQL 13+ database, behind HTTPS", "Sign up and get a workspace in under a minute, with no credit card"],
              ["Updates", "You pull the new image; migrations run on start", "Applied for you"],
              ["Where the data lives", "In your own PostgreSQL database", "In Sirdab's hosted service"],
              ["License", "MIT", "The same MIT-licensed code"],
            ],
          },
        ],
      },
      {
        id: "self-hosted",
        nav: "Free forever: self-host",
        title: "The free CRM you run yourself.",
        blocks: [
          {
            kind: "p",
            text: [
              "The whole application is published on [GitHub](github) under the [MIT License](license). There are no seat limits, no license keys and no features held back. You can use it commercially, change it, and host it for others.",
              "Free here means the software. You still pay for the machine and the database it runs on, and you look after backups, HTTPS and upgrades yourself.",
            ],
          },
          {
            kind: "steps",
            items: [
              { t: "Prepare PostgreSQL", d: "Any PostgreSQL 13 or newer, reached as an ordinary database role." },
              { t: "Run the image", d: "One Docker image serves the API and the web app. The migrations are inside it and run on every start." },
              { t: "Create a workspace", d: "Open the app in a browser, sign up, and invite your team." },
            ],
          },
          {
            kind: "p",
            text: ["Every step, and the one database rule to get right, is in the [self-hosting guide](self-hosted-crm)."],
          },
        ],
      },
      {
        id: "hosted",
        nav: "Hosted: 3 months free",
        title: "The hosted CRM: free for 3 months, then one price.",
        blocks: [
          {
            kind: "p",
            text: [
              "If you would rather not run a server, sign up for the hosted version. Your workspace is ready in under a minute, and you need no credit card to start.",
              "After the first 3 months the hosted plan costs **SAR 24.91 per seat per month, billed annually**: one payment of SAR 299 per seat a year. There is one plan, so there is no higher tier to upgrade to later.",
            ],
          },
          {
            kind: "callout",
            tone: "warn",
            text: "**The hosted version is free for 3 months, not forever.** If you need a CRM that stays free with no end date, self-host the open-source version.",
          },
        ],
      },
      {
        id: "included",
        nav: "What is included",
        title: "What a free CRM from Revenue Engine includes.",
        blocks: [
          {
            kind: "bullets",
            items: [
              "**Pipelines and deals** on a drag-and-drop board, with list, forecast and funnel views, win probabilities, required fields per stage and won and lost reasons.",
              "**People and organizations**, with activities, rich-text notes, @mentions and file attachments.",
              "**Automations and assignment rules** that create activities and deals, call webhooks, send Slack messages and rotate new deals through a team.",
              "**Insights dashboards** built from eight chart types.",
              "**CSV import** that maps columns automatically and recognizes Pipedrive exports.",
              "**English and Arabic**, with a right-to-left layout.",
              "**Ask AI** (beta), a read-only assistant that runs on your workspace's own OpenAI or Anthropic API key.",
            ],
          },
          {
            kind: "fine",
            text: "Not included today: email inbox or calendar sync, email sequences, quotes and invoices, native mobile apps (it is a responsive web app), single sign-on and public API keys.",
          },
        ],
      },
    ],
    faqTitle: "Free CRM questions.",
    faq: [
      {
        q: "Is there a completely free CRM?",
        a: [
          "Yes. The open-source version of Revenue Engine is free to self-host with no time limit, no seat limit and no paid edition. You pay only for the server and database you run it on.",
        ],
      },
      {
        q: "Is the hosted version free forever?",
        a: [
          "No. The hosted version is free for the first 3 months. After that it is SAR 24.91 per seat per month, billed annually as one payment of SAR 299 per seat a year.",
        ],
      },
      {
        q: "Do I need a credit card to try the free CRM?",
        a: ["No. You can create a hosted workspace and start using it without a credit card."],
      },
      {
        q: "Is the free version missing features?",
        a: [
          "No. There is one codebase and no paid edition: the self-hosted and hosted versions run the same application. Ask AI needs an OpenAI or Anthropic API key, which each workspace connects itself.",
        ],
      },
      {
        q: "Does the free CRM work in Arabic?",
        a: [
          "Yes. Each person can use the app in English or Arabic, and in Arabic the layout runs right to left. A few administrator setup screens are still in English only.",
        ],
      },
    ],
  },

  ar: {
    meta: {
      title: "برنامج CRM مجاني ومفتوح المصدر | Revenue Engine",
      description:
        "برنامج CRM مجاني بطريقتين واضحتين: استضف النسخة مفتوحة المصدر بنفسك مجانًا دائمًا، أو استخدم النسخة المستضافة مجانًا لثلاثة أشهر ثم 24.91 ر.س للمقعد شهريًا.",
      imageAlt: "Revenue Engine، برنامج CRM مجاني ومفتوح المصدر لفرق المبيعات.",
    },
    name: "CRM مجاني",
    eyebrow: "الأسعار",
    h1: "برنامج CRM مجاني، بلا شروط مخفية.",
    lead: "Revenue Engine برنامج CRM مجاني بطريقتين: النسخة مفتوحة المصدر لا تكلّفك شيئًا ما دمت تشغّلها على خوادمك، والنسخة المستضافة مجانية لأول ثلاثة أشهر.",
    sections: [
      {
        id: "two-ways",
        nav: "طريقتان مجانيتان",
        title: "نظام CRM مجاني بطريقتين.",
        blocks: [
          {
            kind: "p",
            text: [
              "أغلب العروض التي تحمل اسم «CRM مجاني» إما فترة تجربة وإما نسخة منقوصة المزايا. أما Revenue Engine فله شيفرة واحدة بلا نسخة مدفوعة، فالخياران أدناه يشغّلان التطبيق نفسه: خطوط المبيعات وجهات الاتصال والأتمتة ولوحات التحليلات ذاتها.",
              "الفرق في من يتولّى التشغيل، وإلى متى يبقى بلا تكلفة.",
            ],
          },
          {
            kind: "table",
            head: ["", "استضافة ذاتية (مفتوح المصدر)", "باستضافة Sirdab"],
            rows: [
              ["التكلفة", "yes:مجاني ما دمت تشغّله، ولا تدفع إلا تكلفة خادمك وقاعدة بياناتك", "part:مجاني لأول ثلاثة أشهر، ثم 24.91 ر.س لكل مقعد شهريًا تُدفع سنويًا (299 ر.س لكل مقعد في السنة)"],
              ["من يشغّله", "أنت، على البنية التحتية التي تختارها", "Sirdab"],
              ["الإعداد", "صورة Docker واحدة وقاعدة بيانات PostgreSQL 13 أو أحدث، خلف HTTPS", "سجّل واحصل على مساحة عمل في أقل من دقيقة، بلا بطاقة ائتمان"],
              ["التحديثات", "تسحب الصورة الجديدة، وتُطبَّق الترحيلات عند التشغيل", "تُطبَّق تلقائيًا دون تدخّل منك"],
              ["مكان البيانات", "في قاعدة بيانات PostgreSQL الخاصة بك", "في الخدمة المستضافة لدى Sirdab"],
              ["الرخصة", "MIT", "الشيفرة نفسها برخصة MIT"],
            ],
          },
        ],
      },
      {
        id: "self-hosted",
        nav: "مجاني دائمًا: استضافة ذاتية",
        title: "برنامج CRM مجاني تشغّله بنفسك.",
        blocks: [
          {
            kind: "p",
            text: [
              "التطبيق كاملًا منشور على [GitHub](github) برخصة [MIT](license). لا حدود لعدد المستخدمين، ولا مفاتيح ترخيص، ولا مزايا محجوبة. لك أن تستخدمه تجاريًا وتعدّله وتستضيفه لغيرك.",
              "والمجانية هنا تخص البرنامج نفسه: تبقى عليك تكلفة الخادم وقاعدة البيانات، وأنت من يتولّى النسخ الاحتياطي وشهادة HTTPS والتحديثات.",
            ],
          },
          {
            kind: "steps",
            items: [
              { t: "جهّز PostgreSQL", d: "أي إصدار من PostgreSQL 13 أو أحدث، بدور عادي في قاعدة البيانات." },
              { t: "شغّل الصورة", d: "صورة Docker واحدة تخدم الواجهة البرمجية وتطبيق الويب، والترحيلات بداخلها وتعمل مع كل تشغيل." },
              { t: "أنشئ مساحة العمل", d: "افتح التطبيق في المتصفح، وسجّل، ثم ادعُ فريقك." },
            ],
          },
          {
            kind: "p",
            text: ["كل الخطوات، ومعها قاعدة قاعدة البيانات التي يجب ضبطها، في [دليل الاستضافة الذاتية](self-hosted-crm)."],
          },
        ],
      },
      {
        id: "hosted",
        nav: "مستضاف: ثلاثة أشهر مجانًا",
        title: "النسخة المستضافة: مجانية لثلاثة أشهر، ثم سعر واحد.",
        blocks: [
          {
            kind: "p",
            text: [
              "إن كنت لا تريد إدارة خادم، فسجّل في النسخة المستضافة. تجهز مساحة عملك في أقل من دقيقة، ولا تحتاج إلى بطاقة ائتمان للبدء.",
              "بعد الأشهر الثلاثة الأولى تكلّف الباقة المستضافة **24.91 ر.س لكل مقعد شهريًا، تُدفع سنويًا**: دفعة واحدة قدرها 299 ر.س لكل مقعد في السنة. وهي باقة واحدة، فلا توجد فئة أعلى تُضطر إلى الترقية إليها لاحقًا.",
            ],
          },
          {
            kind: "callout",
            tone: "warn",
            text: "**النسخة المستضافة مجانية لثلاثة أشهر، لا إلى الأبد.** إن كنت تبحث عن نظام CRM مجاني بلا تاريخ انتهاء، فاستضف النسخة مفتوحة المصدر بنفسك.",
          },
        ],
      },
      {
        id: "included",
        nav: "ما الذي يشمله",
        title: "ما الذي يشمله برنامج إدارة علاقات العملاء المجاني من Revenue Engine.",
        blocks: [
          {
            kind: "bullets",
            items: [
              "**خطوط المبيعات والصفقات** على لوحة بالسحب والإفلات، مع عرض القائمة والتوقعات والقمع، واحتمالات الفوز، والحقول الإلزامية لكل مرحلة، وأسباب الفوز والخسارة.",
              "**الأشخاص والمنظمات**، مع الأنشطة والملاحظات المنسّقة والإشارة إلى الزملاء والمرفقات.",
              "**الأتمتة وقواعد الإسناد** التي تنشئ الأنشطة والصفقات، وتستدعي روابط webhook، وترسل رسائل Slack، وتوزّع الصفقات الجديدة على أعضاء الفريق بالتناوب.",
              "**لوحات التحليلات** من ثمانية أنواع من المخططات.",
              "**استيراد CSV** يطابق الأعمدة تلقائيًا ويتعرّف على ملفات التصدير من Pipedrive.",
              "**العربية والإنجليزية**، بواجهة من اليمين إلى اليسار. راجع [برنامج CRM عربي](arabic-crm).",
              "**«اسأل الذكاء الاصطناعي»** (تجريبي)، مساعد للقراءة فقط يعمل بمفتاح API الخاص بمساحة عملك من OpenAI أو Anthropic.",
            ],
          },
          {
            kind: "fine",
            text: "غير متاح حاليًا: مزامنة البريد الوارد أو التقويم، والسلاسل البريدية، وعروض الأسعار والفواتير، وتطبيقات الجوال الأصلية (هو تطبيق ويب متجاوب)، والدخول الموحّد، ومفاتيح الواجهة البرمجية العامة.",
          },
        ],
      },
    ],
    faqTitle: "أسئلة عن البرنامج المجاني.",
    faq: [
      {
        q: "هل يوجد برنامج CRM مجاني بالكامل؟",
        a: [
          "نعم. النسخة مفتوحة المصدر من Revenue Engine مجانية للاستضافة الذاتية بلا مدة محددة، ولا حد لعدد المستخدمين، ولا نسخة مدفوعة. لا تدفع إلا تكلفة الخادم وقاعدة البيانات اللذين تشغّله عليهما.",
        ],
      },
      {
        q: "هل النسخة المستضافة مجانية إلى الأبد؟",
        a: [
          "لا. النسخة المستضافة مجانية لأول ثلاثة أشهر. بعدها تكلّف 24.91 ر.س لكل مقعد شهريًا، تُدفع سنويًا دفعة واحدة قدرها 299 ر.س لكل مقعد.",
        ],
      },
      {
        q: "هل أحتاج إلى بطاقة ائتمان لتجربة برنامج CRM مجاني؟",
        a: ["لا. يمكنك إنشاء مساحة عمل مستضافة والبدء في استخدامها دون بطاقة ائتمان."],
      },
      {
        q: "هل تنقص النسخة المجانية أي مزايا؟",
        a: [
          "لا. هناك شيفرة واحدة بلا نسخة مدفوعة: النسخة الذاتية والنسخة المستضافة تشغّلان التطبيق نفسه. أما «اسأل الذكاء الاصطناعي» فيحتاج إلى مفتاح API من OpenAI أو Anthropic تربطه كل مساحة عمل بنفسها.",
        ],
      },
      {
        q: "هل يعمل نظام CRM المجاني باللغة العربية؟",
        a: [
          "نعم. يستطيع كل شخص استخدام التطبيق بالعربية أو الإنجليزية، وفي العربية تنعكس الواجهة من اليمين إلى اليسار. بعض شاشات الإعداد الخاصة بالمدير ما زالت بالإنجليزية فقط.",
        ],
      },
    ],
  },
};
