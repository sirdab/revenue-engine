import type { Guide } from "../types";

// Arabic target: «نظام إدارة علاقات العملاء» and «نظام CRM» (with «برنامج CRM»,
// «سي آر إم», «إدارة علاقات العملاء»). English: "CRM software".
// Every claim here must be true of the running app: see `llms` in en.ts.

export const crmSoftware: { en: Guide; ar: Guide } = {
  en: {
    meta: {
      title: "CRM software explained, in Arabic and English | Revenue Engine",
      description:
        "What CRM software does, in plain terms, and how Revenue Engine does it: contacts, deals, activities, notes, files, search, CSV import and Ask AI.",
      imageAlt: "Revenue Engine CRM software: a contact record beside a deal's timeline.",
    },
    name: "CRM software",
    eyebrow: "CRM basics",
    h1: "CRM software, explained plainly.",
    lead: "CRM software keeps every customer, every deal and every conversation about them in one place your whole team can see. Revenue Engine is an open-source CRM that does this in English and Arabic, hosted free for 3 months or free to run on your own servers.",
    sections: [
      {
        id: "what-is",
        nav: "What a CRM is",
        title: "What CRM software actually does.",
        blocks: [
          {
            kind: "p",
            text: [
              "CRM stands for customer relationship management. CRM software replaces the spreadsheet, the inbox folders and the notes on someone's phone with one shared record of who your customers are and where each sale stands.",
              "Whatever the product, a CRM does four jobs:",
            ],
          },
          {
            kind: "bullets",
            items: [
              "**Remembers who.** The people you sell to and the organizations they work for, with their details in one place.",
              "**Tracks what is being sold.** Each opportunity is a deal with a value, a stage and an owner.",
              "**Keeps the history.** Calls, meetings, notes and files, in the order they happened, so anyone can pick up where a colleague left off.",
              "**Says what happens next.** A follow-up date on every deal, and reports that show what is likely to close.",
            ],
          },
        ],
      },
      {
        id: "records",
        nav: "Contacts and deals",
        title: "How Revenue Engine keeps the record.",
        blocks: [
          {
            kind: "bullets",
            items: [
              "**Contacts: people and organizations.** A person can belong to an organization, and both link to the deals you are working on with them.",
              "**Deals** on a drag-and-drop pipeline board, with stages, win probabilities, custom fields and won and lost reasons.",
              "**Activities** for calls, meetings, emails, tasks, deadlines and WhatsApp, each with a due date and an owner.",
              "**Notes** in rich text, where you can @mention a colleague.",
              "**Files.** Attach PDFs, images and Office documents of up to 40 MB to a deal or a note.",
              "**A timeline per record** with activities, notes and every field change, showing who made it and when.",
            ],
          },
          {
            kind: "callout",
            tone: "info",
            text: "Revenue Engine is a web app with an English and an Arabic interface, mirrored right to left. Each person picks their own language.",
          },
        ],
      },
      {
        id: "find",
        nav: "Search, import and AI",
        title: "Getting your data in, and finding it again.",
        blocks: [
          {
            kind: "steps",
            items: [
              {
                t: "Import what you have",
                d: "An admin imports organizations, people and deals from CSV files. Columns are matched automatically, and exports from Pipedrive are recognized. Imports create new records; they never update or merge existing ones.",
              },
              {
                t: "Search everything",
                d: "One search box covers deals, people, organizations, activities, notes and attachments. Phone numbers match however they were typed.",
              },
              {
                t: "Ask a question",
                d: "Ask AI, an optional assistant in beta, answers questions about your pipeline from your live records and shows the deals behind each answer. It is read-only.",
              },
            ],
          },
          {
            kind: "callout",
            tone: "warn",
            text: "Ask AI needs an API key of your own: a workspace admin connects an OpenAI or Anthropic key in Settings → Integrations, and usage is billed to that account.",
          },
        ],
      },
      {
        id: "fit",
        nav: "Is it a fit",
        title: "What this CRM software includes, and what it does not.",
        blocks: [
          {
            kind: "table",
            head: ["", "In Revenue Engine"],
            rows: [
              ["Contacts, deals, activities, notes and files", "yes:Included"],
              ["Assignment rules, automations and dashboards", "yes:Included"],
              ["Slack and webhooks", "yes:Included"],
              ["Self-hosting under the MIT license", "yes:Free, one Docker image"],
              ["Mobile", "part:Responsive web app, no native app"],
              ["Email inbox and calendar sync", "no:Not included"],
              ["Email sequences, quotes and invoices", "no:Not included"],
              ["Single sign-on and public API keys", "no:Not included"],
            ],
          },
          {
            kind: "p",
            text: [
              "Related reading: running a team with [sales management software](sales-management), the [open-source CRM](open-source-crm) and its license, [moving from Pipedrive](pipedrive-alternative), and the [self-hosting guide](self-hosted-crm).",
            ],
          },
        ],
      },
    ],
    faqTitle: "CRM questions.",
    faq: [
      {
        q: "What is CRM software?",
        a: [
          "CRM (customer relationship management) software keeps your contacts, deals and your team's activities in one shared place, so everyone knows who the customer is, where each deal stands and what the next step is.",
        ],
      },
      {
        q: "Is this CRM software free?",
        a: [
          "The open-source version is free: it is MIT licensed, and you pay only for the servers you run it on. The hosted version is free for the first 3 months, then SAR 24.91 per seat per month, billed annually as one payment of SAR 299 per seat a year.",
        ],
      },
      {
        q: "Can I bring my contacts from Excel or another CRM?",
        a: [
          "Yes, as CSV files. Save each sheet as CSV, or export from your current CRM, and import organizations, people and deals. Pipedrive exports are recognized. Activities, notes and files are not imported.",
        ],
      },
      {
        q: "What do I need to use Ask AI?",
        a: [
          "Your own OpenAI or Anthropic API key, which a workspace admin connects in Settings → Integrations. The assistant is optional, in beta, and cannot change records.",
        ],
      },
      {
        q: "Does it sync my email and calendar?",
        a: [
          "No. Revenue Engine does not sync email inboxes or calendars, and it has no native mobile app or single sign-on. It connects to other tools through Slack and webhooks.",
        ],
      },
    ],
  },

  ar: {
    meta: {
      title: "نظام إدارة علاقات العملاء CRM بالعربية | Revenue Engine",
      description:
        "ما هو نظام إدارة علاقات العملاء وماذا يفعل، بلغة بسيطة، وكيف يطبّقه Revenue Engine: جهات الاتصال والصفقات والأنشطة والملاحظات والبحث والاستيراد.",
      imageAlt: "نظام CRM من Revenue Engine: سجل جهة اتصال بجانب الخط الزمني لصفقة.",
    },
    name: "نظام إدارة علاقات العملاء",
    eyebrow: "أساسيات CRM",
    h1: "نظام إدارة علاقات العملاء، شرحٌ بلا تعقيد.",
    lead: "نظام إدارة علاقات العملاء يحفظ كل عميل وكل صفقة وكل تواصل معهما في مكان واحد يراه فريقك كله. وRevenue Engine نظام CRM مفتوح المصدر يؤدي ذلك بالعربية والإنجليزية، مستضافًا مجانًا لثلاثة أشهر أو مجانًا على خوادمك.",
    sections: [
      {
        id: "what-is",
        nav: "ما هو نظام CRM",
        title: "ما الذي يفعله نظام CRM فعلًا؟",
        blocks: [
          {
            kind: "p",
            text: [
              "نظام CRM، أو «سي آر إم» كما يُنطق، اختصار لعبارة Customer Relationship Management، أي إدارة علاقات العملاء. يحلّ محلّ جداول البيانات ومجلدات البريد والملاحظات المتفرقة في جوالات الفريق، فيصبح لديكم سجل واحد مشترك يبيّن من عملاؤكم وأين تقف كل صفقة.",
              "وأيًّا كان البرنامج، فإن نظام إدارة علاقات العملاء يؤدي أربع مهام:",
            ],
          },
          {
            kind: "bullets",
            items: [
              "**يتذكّر من.** الأشخاص الذين تبيع لهم والمنظمات التي يعملون فيها، وبياناتهم في مكان واحد.",
              "**يتتبّع ما يُباع.** كل فرصة صفقةٌ لها قيمة ومرحلة ومالك.",
              "**يحفظ التاريخ.** المكالمات والاجتماعات والملاحظات والملفات بترتيب حدوثها، فيكمل أي زميل من حيث توقّف غيره.",
              "**يحدد الخطوة التالية.** موعد متابعة لكل صفقة، وتقارير تبيّن ما يُرجَّح إغلاقه.",
            ],
          },
        ],
      },
      {
        id: "records",
        nav: "جهات الاتصال والصفقات",
        title: "كيف يحفظ Revenue Engine سجل العميل.",
        blocks: [
          {
            kind: "p",
            text: [
              "في برنامج CRM هذا تدور إدارة علاقات العملاء حول سجلات مترابطة:",
            ],
          },
          {
            kind: "bullets",
            items: [
              "**جهات الاتصال: الأشخاص والمنظمات.** يمكن أن ينتمي الشخص إلى منظمة، وكلاهما مرتبط بالصفقات التي تعمل عليها معهما.",
              "**الصفقات** على لوحة خط مبيعات بالسحب والإفلات، مع المراحل واحتمالات الفوز والحقول المخصصة وأسباب الفوز والخسارة.",
              "**الأنشطة**: مكالمات واجتماعات ورسائل بريد ومهام ومواعيد نهائية وواتساب، لكلٍّ منها موعد ومالك.",
              "**الملاحظات** بنص منسّق، ويمكنك فيها الإشارة إلى زميل بعلامة @.",
              "**الملفات.** أرفق ملفات PDF والصور ومستندات Office حتى 40 ميغابايت بصفقة أو بملاحظة.",
              "**خط زمني لكل سجل** يضم الأنشطة والملاحظات وكل تغيير في الحقول، مع من أجراه ومتى.",
            ],
          },
          {
            kind: "callout",
            tone: "info",
            text: "Revenue Engine تطبيق ويب بواجهة عربية وإنجليزية، والعربية معكوسة من اليمين إلى اليسار. ويختار كل شخص لغته.",
          },
        ],
      },
      {
        id: "find",
        nav: "البحث والاستيراد والذكاء الاصطناعي",
        title: "أدخل بياناتك، واعثر عليها متى شئت.",
        blocks: [
          {
            kind: "steps",
            items: [
              {
                t: "استورد ما لديك",
                d: "يستورد مدير مساحة العمل المنظمات والأشخاص والصفقات من ملفات CSV. تُطابَق الأعمدة تلقائيًا، ويُتعرَّف على ملفات التصدير من Pipedrive. الاستيراد ينشئ سجلات جديدة ولا يحدّث السجلات الموجودة ولا يدمجها.",
              },
              {
                t: "ابحث في كل شيء",
                d: "مربع بحث واحد يشمل الصفقات والأشخاص والمنظمات والأنشطة والملاحظات والمرفقات، وأرقام الهواتف تُطابَق كيفما كُتبت.",
              },
              {
                t: "اطرح سؤالًا",
                d: "«اسأل الذكاء الاصطناعي» مساعد اختياري في طور التجربة، يجيب عن أسئلتك حول خط المبيعات من سجلاتك الحية ويُريك الصفقات التي بنى عليها إجابته. وهو للقراءة فقط.",
              },
            ],
          },
          {
            kind: "callout",
            tone: "warn",
            text: "يحتاج «اسأل الذكاء الاصطناعي» إلى مفتاح API خاص بك: يربط مدير مساحة العمل مفتاحًا من OpenAI أو Anthropic من الإعدادات ← التكاملات، وتُحتسب تكلفة الاستخدام على ذلك الحساب.",
          },
        ],
      },
      {
        id: "fit",
        nav: "هل يناسبك؟",
        title: "ما يتضمنه نظام CRM هذا، وما لا يتضمنه.",
        blocks: [
          {
            kind: "table",
            head: ["", "في Revenue Engine"],
            rows: [
              ["جهات الاتصال والصفقات والأنشطة والملاحظات والملفات", "yes:متوفر"],
              ["قواعد الإسناد والأتمتة ولوحات التحليلات", "yes:متوفر"],
              ["Slack وروابط webhook", "yes:متوفر"],
              ["الاستضافة الذاتية برخصة MIT", "yes:مجانًا، بصورة Docker واحدة"],
              ["الجوال", "part:تطبيق ويب متجاوب، بلا تطبيق أصلي"],
              ["مزامنة البريد الوارد والتقويم", "no:غير متوفرة"],
              ["السلاسل البريدية وعروض الأسعار والفواتير", "no:غير متوفرة"],
              ["الدخول الموحّد (SSO) ومفاتيح API العامة", "no:غير متوفرة"],
            ],
          },
          {
            kind: "p",
            text: [
              "اقرأ أيضًا: إدارة فريقك عبر [برنامج إدارة المبيعات](sales-management)، و[نظام CRM مفتوح المصدر](open-source-crm) ورخصته، و[الانتقال من Pipedrive](pipedrive-alternative)، و[دليل الاستضافة الذاتية](self-hosted-crm).",
            ],
          },
        ],
      },
    ],
    faqTitle: "أسئلة عن أنظمة CRM.",
    faq: [
      {
        q: "ما هو نظام إدارة علاقات العملاء؟",
        a: [
          "نظام إدارة علاقات العملاء (CRM) يجمع جهات اتصالك وصفقاتك وأنشطة فريقك في مكان واحد مشترك، فيعرف الجميع من العميل وأين تقف كل صفقة وما الخطوة التالية.",
        ],
      },
      {
        q: "هل نظام CRM هذا مجاني؟",
        a: [
          "النسخة مفتوحة المصدر مجانية: منشورة برخصة MIT، ولا تدفع إلا تكلفة الخوادم التي تشغّلها عليها. والنسخة المستضافة مجانية لأول ثلاثة أشهر، ثم 24.91 ر.س لكل مقعد شهريًا، تُدفع سنويًا دفعة واحدة قدرها 299 ر.س لكل مقعد.",
        ],
      },
      {
        q: "كيف أنقل بيانات عملائي من Excel أو من نظام إدارة علاقات العملاء الحالي؟",
        a: [
          "عبر ملفات CSV. احفظ كل جدول بصيغة CSV أو صدّر بياناتك من نظامك الحالي، ثم استورد المنظمات والأشخاص والصفقات. ملفات التصدير من Pipedrive يُتعرَّف عليها تلقائيًا. أما الأنشطة والملاحظات والملفات فلا تُستورد.",
        ],
      },
      {
        q: "ماذا أحتاج لاستخدام «اسأل الذكاء الاصطناعي»؟",
        a: [
          "مفتاح API خاص بك من OpenAI أو Anthropic، يربطه مدير مساحة العمل من الإعدادات ← التكاملات. المساعد اختياري وفي طور التجربة، ولا يستطيع تعديل السجلات.",
        ],
      },
      {
        q: "هل يزامن بريدي الإلكتروني وتقويمي؟",
        a: [
          "لا. لا يزامن Revenue Engine البريد الوارد ولا التقويم، وليس له تطبيق جوال أصلي ولا دخول موحّد. ويتصل بالأدوات الأخرى عبر Slack وروابط webhook.",
        ],
      },
    ],
  },
};
