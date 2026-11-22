import type { Guide } from "../types";

// Arabic target: «برنامج إدارة المبيعات» (with «نظام إدارة المبيعات»,
// «إدارة فريق المبيعات», «متابعة المبيعات»). English: "sales management software".
// Every claim here must be true of the running app: see `llms` in en.ts.

export const salesManagement: { en: Guide; ar: Guide } = {
  en: {
    meta: {
      title: "Sales management software for your team | Revenue Engine",
      description:
        "Sales management software for running a sales team: pipelines, next activities, round-robin assignment, automations and forecasts. Free for 3 months.",
      imageAlt: "Revenue Engine sales management software: a pipeline board with deals by stage.",
    },
    name: "Sales management software",
    eyebrow: "Sales management",
    h1: "Sales management software for the way a team actually sells.",
    lead: "Revenue Engine is sales management software that keeps pipelines, follow-ups, lead assignment and forecasts in one workspace, in English and Arabic. Try it hosted free for 3 months, or run the open-source code on your own servers for free.",
    sections: [
      {
        id: "pipeline",
        nav: "Pipelines and stages",
        title: "Good sales management software starts with the pipeline.",
        blocks: [
          {
            kind: "p",
            text: [
              "Managing sales day to day comes down to a few questions: what is open, where it stands, who owns it, and what happens next. In Revenue Engine the answer is the deal board, and it is the screen your team works from.",
            ],
          },
          {
            kind: "bullets",
            items: [
              "**Several pipelines**, each with its own stages and a win probability per stage, so new business and renewals do not share one board.",
              "**Required fields per stage.** A deal cannot enter a stage until the fields that stage asks for are filled, so the process is followed rather than remembered.",
              "**Four views of the same deals:** a drag-and-drop board, a list, a forecast by expected close month and a funnel with stage-to-stage conversion.",
              "**Custom fields, filters and saved views** on the deal list, and a board you can narrow to one pipeline or one owner.",
              "**Won and lost** in one click, with lost reasons you define, plus merge, archive and restore for the deals that need tidying.",
            ],
          },
        ],
      },
      {
        id: "follow-up",
        nav: "Follow-up",
        title: "Every deal keeps a next step.",
        blocks: [
          {
            kind: "p",
            text: [
              "In sales management software, follow-up is the part that slips first, and most deals are lost to silence rather than to a competitor. Revenue Engine builds it around the next activity: each deal should have one, and the board shows at a glance which do not.",
            ],
          },
          {
            kind: "bullets",
            items: [
              "**Activities** for calls, meetings, emails, tasks, deadlines and WhatsApp, linked to the deal and the people on it.",
              "**Colored by urgency:** overdue, due today, scheduled, or nothing planned.",
              "**Rotting deals.** Give a stage a number of days, and a deal that sits in it longer is flagged, first amber and then red.",
              "**One timeline per deal** with its activities, notes, files and every field change, showing who made it and when.",
            ],
          },
          {
            kind: "callout",
            tone: "info",
            text: "Activities are logged and scheduled in Revenue Engine. It does not sync your email inbox or calendar, and it does not send email sequences.",
          },
        ],
      },
      {
        id: "team",
        nav: "Running the team",
        title: "Assignment, automation and ownership.",
        blocks: [
          {
            kind: "p",
            text: [
              "Sales team management is mostly about making sure nothing waits for someone to notice it. Every deal has an owner, and rules decide who that is and what happens next.",
            ],
          },
          {
            kind: "steps",
            items: [
              {
                t: "Set up your teams",
                d: "Add your reps to the workspace as members or admins, and group them into teams.",
              },
              {
                t: "Add an assignment rule",
                d: "Send new deals to a fixed owner, or rotate them through a team in turn (round-robin), so incoming leads are shared fairly.",
              },
              {
                t: "Automate the next step",
                d: "When a deal is created or updated and matches your conditions, create an activity or a deal, send a Slack message, notify people or call a webhook.",
              },
            ],
          },
          {
            kind: "p",
            text: [
              "Leads from website forms and ads can arrive through an inbound webhook, authenticated with your workspace's own secret, and go through the same assignment rules as any other new deal.",
            ],
          },
        ],
      },
      {
        id: "numbers",
        nav: "Forecasts and insights",
        title: "The numbers a sales manager asks for.",
        blocks: [
          {
            kind: "table",
            head: ["Question", "Where Revenue Engine answers it"],
            rows: [
              ["What will close, and when?", "The forecast view: open deals by expected close month, with their weighted value."],
              ["Where do deals stall?", "The funnel view, with conversion from each stage to the next."],
              ["Why are we losing?", "Lost reasons you define, charted on an Insights dashboard."],
              ["Is the team doing the work?", "Charts of logged activities on an Insights dashboard."],
            ],
          },
          {
            kind: "p",
            text: [
              "Insights dashboards are built from eight chart types over your deals and activities: bar, bar list, line, area, pie, funnel, KPI and table. Compare any widget with the previous period, draw a goal line, or build a starter dashboard in one click.",
              "Related reading: what [CRM software](crm-software) does, why the [open-source CRM](open-source-crm) is free, [moving from Pipedrive](pipedrive-alternative), and the [self-hosting guide](self-hosted-crm).",
            ],
          },
        ],
      },
    ],
    faqTitle: "Sales management questions.",
    faq: [
      {
        q: "What is sales management software?",
        a: [
          "Sales management software is where a sales team keeps its pipeline: the open deals, their stages and owners, the next activity on each, and the numbers that show what is likely to close. Revenue Engine does this with pipelines, activities, assignment rules, automations and dashboards.",
        ],
      },
      {
        q: "Can the sales management software assign new leads automatically?",
        a: [
          "Yes. Assignment rules give each new deal a fixed owner or rotate deals through a team in turn. Leads can come from the app, a CSV import or an inbound webhook connected to your forms.",
        ],
      },
      {
        q: "How much does Revenue Engine cost?",
        a: [
          "The hosted version is free for the first 3 months, then SAR 24.91 per seat per month, billed annually as one payment of SAR 299 per seat a year. The open-source version is MIT licensed and free to host yourself.",
        ],
      },
      {
        q: "Does it sync email and calendars?",
        a: [
          "No. Revenue Engine does not sync email inboxes or calendars, send email sequences, or produce quotes and invoices. You log calls, meetings, emails and other activities in the app, and it connects to other tools through Slack and webhooks.",
        ],
      },
      {
        q: "Is there a mobile app?",
        a: [
          "There is no native mobile app. Revenue Engine is a responsive web app that works in the browser on a phone.",
        ],
      },
    ],
  },

  ar: {
    meta: {
      title: "برنامج إدارة المبيعات ومتابعة الصفقات | Revenue Engine",
      description:
        "برنامج إدارة المبيعات لفريقك: خطوط مبيعات، وأنشطة تالية لكل صفقة، وتوزيع العملاء المحتملين بالتناوب، وأتمتة وتوقعات. مجانًا لأول ثلاثة أشهر.",
      imageAlt: "برنامج إدارة المبيعات Revenue Engine: لوحة خط مبيعات فيها الصفقات بحسب المرحلة.",
    },
    name: "برنامج إدارة المبيعات",
    eyebrow: "إدارة المبيعات",
    h1: "برنامج إدارة المبيعات الذي يعرف فيه كل مندوب خطوته التالية.",
    lead: "Revenue Engine برنامج إدارة المبيعات يجمع خطوط المبيعات والمتابعات وتوزيع العملاء المحتملين والتوقعات في مساحة عمل واحدة، بالعربية والإنجليزية. جرّب النسخة المستضافة مجانًا لثلاثة أشهر، أو شغّل الشيفرة مفتوحة المصدر على خوادمك مجانًا.",
    sections: [
      {
        id: "pipeline",
        nav: "خطوط المبيعات والمراحل",
        title: "برنامج إدارة المبيعات يبدأ من خط المبيعات.",
        blocks: [
          {
            kind: "p",
            text: [
              "إدارة المبيعات اليومية تدور حول أسئلة قليلة: ما الصفقات المفتوحة، وأين تقف كلٌّ منها، ومن مالكها، وما الخطوة التالية. في Revenue Engine تجد الإجابة في لوحة الصفقات، وهي الشاشة التي يعمل منها فريقك.",
            ],
          },
          {
            kind: "bullets",
            items: [
              "**أكثر من خط مبيعات**، لكلٍّ منها مراحله واحتمال فوز لكل مرحلة، فلا تتزاحم الصفقات الجديدة والتجديدات في لوحة واحدة.",
              "**حقول إلزامية لكل مرحلة.** لا تدخل الصفقة مرحلةً حتى تُملأ الحقول التي تشترطها، فتُطبَّق آلية البيع بدل الاعتماد على الذاكرة.",
              "**أربع طرق لعرض الصفقات نفسها:** لوحة بالسحب والإفلات، وقائمة، وتوقعات بحسب شهر الإغلاق المتوقع، وقمع يبيّن التحويل من مرحلة إلى أخرى.",
              "**حقول مخصصة وعوامل تصفية وطرق عرض محفوظة** في قائمة الصفقات، ولوحة يمكنك حصرها في خط مبيعات واحد أو مالك واحد.",
              "**الفوز والخسارة** بنقرة واحدة، مع أسباب خسارة تحددها أنت، إضافة إلى الدمج والأرشفة والاستعادة.",
            ],
          },
        ],
      },
      {
        id: "follow-up",
        nav: "متابعة المبيعات",
        title: "لكل صفقة خطوة تالية.",
        blocks: [
          {
            kind: "p",
            text: [
              "متابعة المبيعات في برنامج إدارة المبيعات هذا تقوم على النشاط التالي: لكل صفقة نشاط قادم، واللوحة تكشف لك فورًا الصفقات التي لا نشاط لها. فأغلب الصفقات تضيع بالإهمال لا بالمنافسة.",
            ],
          },
          {
            kind: "bullets",
            items: [
              "**الأنشطة**: مكالمات واجتماعات ورسائل بريد ومهام ومواعيد نهائية وواتساب، مرتبطة بالصفقة وبالأشخاص المعنيين بها.",
              "**ألوان بحسب الاستعجال:** متأخر، أو مستحق اليوم، أو مجدول، أو لا شيء مخطط له.",
              "**الصفقات الراكدة.** حدّد عدد أيام لكل مرحلة، والصفقة التي تتجاوزها تُعلَّم بالكهرماني ثم بالأحمر.",
              "**خط زمني لكل صفقة** يضم أنشطتها وملاحظاتها وملفاتها وكل تغيير في حقولها، مع من أجراه ومتى.",
            ],
          },
          {
            kind: "callout",
            tone: "info",
            text: "تُسجَّل الأنشطة وتُجدوَل داخل Revenue Engine. لا يزامن البرنامج بريدك الوارد ولا تقويمك، ولا يرسل سلاسل بريدية.",
          },
        ],
      },
      {
        id: "team",
        nav: "إدارة فريق المبيعات",
        title: "إدارة فريق المبيعات: الإسناد والأتمتة والملكية.",
        blocks: [
          {
            kind: "p",
            text: [
              "إدارة فريق المبيعات تعني ألّا ينتظر شيءٌ أن ينتبه إليه أحد. لكل صفقة مالك، والقواعد هي التي تحدد من يكون وما الذي يحدث بعد ذلك.",
            ],
          },
          {
            kind: "steps",
            items: [
              {
                t: "أنشئ فرقك",
                d: "أضف المندوبين إلى مساحة العمل أعضاءً أو مديرين، ووزّعهم على فرق.",
              },
              {
                t: "أضف قاعدة إسناد",
                d: "وجّه الصفقات الجديدة إلى مالك ثابت، أو وزّعها بالتناوب على أعضاء الفريق، فيُقسَّم العملاء المحتملون بعدل.",
              },
              {
                t: "أتمت الخطوة التالية",
                d: "عند إنشاء صفقة أو تحديثها وانطباق شروطك عليها: أنشئ نشاطًا أو صفقة، أو أرسل رسالة على Slack، أو أشعِر الأشخاص، أو استدعِ webhook.",
              },
            ],
          },
          {
            kind: "p",
            text: [
              "ويمكن أن يصل العملاء المحتملون من نماذج موقعك وإعلاناتك عبر رابط webhook وارد، موثَّق بسرّ خاص بمساحة عملك، فيمرّون بقواعد الإسناد نفسها كأي صفقة جديدة.",
            ],
          },
        ],
      },
      {
        id: "numbers",
        nav: "التوقعات والتحليلات",
        title: "الأرقام التي يسأل عنها مدير المبيعات.",
        blocks: [
          {
            kind: "table",
            head: ["السؤال", "أين تجد الإجابة في Revenue Engine"],
            rows: [
              ["ما الذي سيُغلق، ومتى؟", "عرض التوقعات: الصفقات المفتوحة بحسب شهر الإغلاق المتوقع، مع قيمتها المرجّحة."],
              ["أين تتعثر الصفقات؟", "عرض القمع، مع نسبة التحويل من كل مرحلة إلى التي تليها."],
              ["لماذا نخسر؟", "أسباب الخسارة التي تحددها، معروضة في لوحة تحليلات."],
              ["هل يؤدي الفريق عمله؟", "مخططات الأنشطة المسجَّلة في لوحة التحليلات."],
            ],
          },
          {
            kind: "p",
            text: [
              "تُبنى لوحات التحليلات في نظام إدارة المبيعات هذا من ثمانية أنواع من المخططات على صفقاتك وأنشطتك: أعمدة، وقائمة أعمدة، وخطي، ومساحي، ودائري، وقمع، ومؤشر رئيسي، وجدول. قارن أي أداة بالفترة السابقة، أو ارسم خط الهدف، أو ابنِ لوحة أولية بنقرة واحدة.",
              "اقرأ أيضًا: ما الذي يفعله [نظام إدارة علاقات العملاء](crm-software)، ولماذا [نظام CRM مفتوح المصدر](open-source-crm) مجاني، و[الانتقال من Pipedrive](pipedrive-alternative)، و[دليل الاستضافة الذاتية](self-hosted-crm).",
            ],
          },
        ],
      },
    ],
    faqTitle: "أسئلة عن إدارة المبيعات.",
    faq: [
      {
        q: "ما هو برنامج إدارة المبيعات؟",
        a: [
          "برنامج إدارة المبيعات هو المكان الذي يحفظ فيه فريق المبيعات خط مبيعاته: الصفقات المفتوحة ومراحلها ومالكوها، والنشاط التالي لكل صفقة، والأرقام التي تبيّن ما يُرجَّح إغلاقه. يقدّم Revenue Engine ذلك عبر خطوط المبيعات والأنشطة وقواعد الإسناد والأتمتة ولوحات التحليلات.",
        ],
      },
      {
        q: "هل يوزّع برنامج إدارة المبيعات العملاء المحتملين تلقائيًا؟",
        a: [
          "نعم. قواعد الإسناد تعطي كل صفقة جديدة مالكًا ثابتًا، أو توزّع الصفقات بالتناوب على أعضاء فريق. ويمكن أن تصل الصفقات من التطبيق نفسه، أو من استيراد ملف CSV، أو من رابط webhook وارد متصل بنماذجك.",
        ],
      },
      {
        q: "كم تكلفة Revenue Engine؟",
        a: [
          "النسخة المستضافة مجانية لأول ثلاثة أشهر، ثم 24.91 ر.س لكل مقعد شهريًا، تُدفع سنويًا دفعة واحدة قدرها 299 ر.س لكل مقعد. والنسخة مفتوحة المصدر منشورة برخصة MIT ومجانية لتستضيفها بنفسك.",
        ],
      },
      {
        q: "هل يزامن البريد الإلكتروني والتقويم؟",
        a: [
          "لا. لا يزامن Revenue Engine البريد الوارد ولا التقويم، ولا يرسل سلاسل بريدية، ولا يصدر عروض أسعار أو فواتير. تسجّل المكالمات والاجتماعات ورسائل البريد وغيرها من الأنشطة داخل التطبيق، ويتصل بالأدوات الأخرى عبر Slack وروابط webhook.",
        ],
      },
      {
        q: "هل له تطبيق جوال؟",
        a: [
          "ليس له تطبيق جوال أصلي. Revenue Engine تطبيق ويب متجاوب يعمل من متصفح الجوال.",
        ],
      },
    ],
  },
};
