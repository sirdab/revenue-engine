// The "Arabic CRM" page. Search phrase: "Arabic CRM" / «برنامج CRM عربي».
//
// Every claim is checked against the app: the Arabic interface and its
// right-to-left layout (src/lib/i18n), per-person language, `dir="auto"` on
// record names, IBM Plex Sans Arabic from Sirdab One, and phone search
// (api-server/src/lib/queries.ts). A few admin setup screens are still in
// English only, and the page says so.

import type { Guide } from "../types";

export const arabicCrm: { en: Guide; ar: Guide } = {
  en: {
    meta: {
      title: "Arabic CRM with a right-to-left interface | Revenue Engine",
      description:
        "An Arabic CRM built for Arabic-speaking sales teams: a right-to-left interface, Arabic and English side by side, and Ask AI in either language. Open source.",
      imageAlt: "Revenue Engine, an Arabic CRM with a right-to-left interface.",
    },
    name: "Arabic CRM",
    eyebrow: "Arabic",
    h1: "An Arabic CRM, built right to left.",
    lead: "Revenue Engine is an Arabic CRM for sales teams that work in Arabic and English: the interface mirrors right to left, each person picks their language, and records in both languages sit side by side.",
    sections: [
      {
        id: "interface",
        nav: "The interface",
        title: "An Arabic CRM, not a translated one.",
        blocks: [
          {
            kind: "p",
            text: [
              "An Arabic CRM has to do more than swap the words. In Arabic, Revenue Engine mirrors the whole layout: navigation, the deal board, tables, forms and drawers all run right to left, and icons that point a direction turn around with them.",
            ],
          },
          {
            kind: "bullets",
            items: [
              "**Each person picks their language.** One colleague can work in Arabic while another works in English, in the same workspace, and either can switch at any time.",
              "**The choice follows you** across devices.",
              "**Arabic typography.** Arabic text is set in IBM Plex Sans Arabic, a typeface drawn for screens.",
              "**Light and dark themes** in both languages.",
            ],
          },
          {
            kind: "callout",
            tone: "info",
            text: "A few administrator setup screens are still in English only. The screens your sales team uses every day are in Arabic.",
          },
        ],
      },
      {
        id: "mixed",
        nav: "Arabic and English together",
        title: "Arabic and English names in the same pipeline.",
        blocks: [
          {
            kind: "p",
            text: [
              "Sales teams in the region rarely work in one language. A deal may be named in Arabic while the organization behind it has an English name, and a contact's title may mix both.",
              "Revenue Engine lets each name keep its own direction. Arabic and English record names sit side by side in lists, cards and detail pages, and mixed text, numbers included, reads in the right order.",
            ],
          },
          {
            kind: "table",
            head: ["", "What it means for your team"],
            rows: [
              ["Record names", "yes:Deals, people and organizations can be named in Arabic or English, and each displays in its own direction"],
              ["Phone search", "yes:Spaces and dashes do not matter, and searching a local number such as 050 123 4567 finds one saved as +966 50 123 4567"],
              ["Search", "yes:One search box covers deals, people, organizations, activities, notes and attachments"],
              ["Prices", "yes:The hosted plan is priced in Saudi riyals"],
            ],
          },
        ],
      },
      {
        id: "ask-ai",
        nav: "Ask AI in Arabic",
        title: "Ask your pipeline a question in Arabic.",
        blocks: [
          {
            kind: "p",
            text: [
              "Ask AI is an optional assistant, in beta, that answers questions about your pipeline from your live records. Ask in Arabic or in English, and each answer comes with the deals and records it was drawn from.",
              "It is read-only: it can look records up, but it has no way to change one. It runs on your workspace's own OpenAI or Anthropic API key, which an admin connects in Settings → Integrations, so usage is billed to your account.",
            ],
          },
        ],
      },
      {
        id: "pricing",
        nav: "Price and origin",
        title: "Built in Saudi Arabia, priced in riyals.",
        blocks: [
          {
            kind: "p",
            text: [
              "Revenue Engine is built and maintained by [Sirdab](company), a Saudi company, and published as open source under the [MIT License](license).",
              "The hosted version is free for the first 3 months, then **SAR 24.91 per seat per month, billed annually** (SAR 299 per seat a year). The open-source version is free to run on your own servers: see the [self-hosting guide](self-hosted-crm) or the [free CRM](free-crm) page for both options side by side.",
            ],
          },
          {
            kind: "fine",
            text: "Not included today: email inbox or calendar sync, email sequences, quotes and invoices, native mobile apps (it is a responsive web app), single sign-on and public API keys.",
          },
        ],
      },
    ],
    faqTitle: "Arabic CRM questions.",
    faq: [
      {
        q: "Is Revenue Engine a fully Arabic CRM?",
        a: [
          "The app is available in Arabic and English, and in Arabic the whole layout runs right to left: navigation, boards, tables and forms. A few administrator setup screens are still in English only.",
        ],
      },
      {
        q: "Can my team use the Arabic CRM in English too?",
        a: [
          "Yes. Each person chooses their own language and can switch at any time, so Arabic and English speakers work in the same workspace.",
        ],
      },
      {
        q: "Can records mix Arabic and English?",
        a: [
          "Yes. Deals, people and organizations can be named in either language, and each name displays in its own direction next to the others.",
        ],
      },
      {
        q: "Does Ask AI understand Arabic?",
        a: [
          "Yes. You can ask questions about your pipeline in Arabic or English. Ask AI is in beta, is read-only, and runs on your workspace's own OpenAI or Anthropic API key.",
        ],
      },
      {
        q: "What does it cost?",
        a: [
          "The hosted version is free for the first 3 months, then SAR 24.91 per seat per month, billed annually as SAR 299 per seat a year. The open-source version is free to self-host.",
        ],
      },
    ],
  },

  ar: {
    meta: {
      title: "برنامج CRM عربي بواجهة من اليمين إلى اليسار | Revenue Engine",
      description:
        "برنامج CRM عربي لفرق المبيعات: واجهة باللغة العربية من اليمين إلى اليسار، وأسماء عربية وإنجليزية جنبًا إلى جنب، ومساعد ذكاء اصطناعي يفهم سؤالك بالعربية.",
      imageAlt: "Revenue Engine، برنامج CRM عربي بواجهة من اليمين إلى اليسار.",
    },
    name: "CRM عربي",
    eyebrow: "العربية",
    h1: "برنامج CRM عربي، مبنيٌّ من اليمين إلى اليسار.",
    lead: "Revenue Engine برنامج CRM عربي لفرق المبيعات التي تعمل بالعربية والإنجليزية: تنعكس الواجهة من اليمين إلى اليسار، ويختار كل شخص لغته، وتظهر السجلات باللغتين جنبًا إلى جنب.",
    sections: [
      {
        id: "interface",
        nav: "الواجهة العربية",
        title: "برنامج CRM عربي، لا واجهة مترجمة.",
        blocks: [
          {
            kind: "p",
            text: [
              "نظام CRM باللغة العربية يحتاج إلى أكثر من ترجمة الكلمات. في العربية تنعكس واجهة Revenue Engine كلها: التنقل ولوحة الصفقات والجداول والنماذج واللوحات الجانبية تسير من اليمين إلى اليسار، وتنقلب معها الأيقونات التي تشير إلى اتجاه.",
            ],
          },
          {
            kind: "bullets",
            items: [
              "**كل شخص يختار لغته.** يعمل زميل بالعربية وآخر بالإنجليزية في مساحة العمل نفسها، ويستطيع أيٌّ منهما التبديل متى شاء.",
              "**اختيارك يرافقك** على كل أجهزتك.",
              "**خط عربي واضح.** النصوص العربية مكتوبة بخط IBM Plex Sans Arabic المصمَّم للشاشات.",
              "**وضعان فاتح وداكن** في اللغتين.",
            ],
          },
          {
            kind: "callout",
            tone: "info",
            text: "بعض شاشات الإعداد الخاصة بالمدير ما زالت بالإنجليزية فقط. أما الشاشات التي يستخدمها فريق المبيعات كل يوم فهي بالعربية.",
          },
        ],
      },
      {
        id: "mixed",
        nav: "العربية والإنجليزية معًا",
        title: "CRM يدعم العربية والإنجليزية في خط المبيعات نفسه.",
        blocks: [
          {
            kind: "p",
            text: [
              "نادرًا ما تعمل فرق المبيعات في المنطقة بلغة واحدة: قد تحمل الصفقة اسمًا عربيًا والمنظمة التي وراءها اسمًا إنجليزيًا، وقد يجمع المسمّى الوظيفي لجهة الاتصال بين اللغتين.",
              "في Revenue Engine يحتفظ كل اسم باتجاهه. تظهر أسماء السجلات العربية والإنجليزية جنبًا إلى جنب في القوائم والبطاقات وصفحات التفاصيل، ويُقرأ النص المختلط، بأرقامه، بالترتيب الصحيح.",
            ],
          },
          {
            kind: "table",
            head: ["", "ما يعنيه ذلك لفريقك"],
            rows: [
              ["أسماء السجلات", "yes:تسمّي الصفقات والأشخاص والمنظمات بالعربية أو الإنجليزية، ويُعرض كل اسم باتجاهه"],
              ["البحث برقم الجوال", "yes:المسافات والشرطات لا تؤثر، والبحث بالرقم المحلي مثل 050 123 4567 يجد الرقم المحفوظ بصيغة ‎+966 50 123 4567"],
              ["البحث الشامل", "yes:مربع بحث واحد يشمل الصفقات والأشخاص والمنظمات والأنشطة والملاحظات والمرفقات"],
              ["الأسعار", "yes:الباقة المستضافة مسعّرة بالريال السعودي"],
            ],
          },
        ],
      },
      {
        id: "ask-ai",
        nav: "اسأل بالعربية",
        title: "اسأل خط مبيعاتك بالعربية.",
        blocks: [
          {
            kind: "p",
            text: [
              "«اسأل الذكاء الاصطناعي» مساعد اختياري في طور التجربة، يجيب عن أسئلتك حول خط المبيعات من سجلاتك الحية. اكتب سؤالك بالعربية أو الإنجليزية، وتأتي كل إجابة مع الصفقات والسجلات التي استُخلصت منها.",
              "وهو للقراءة فقط: يبحث في السجلات ولا يملك وسيلة لتغيير أيٍّ منها. يعمل بمفتاح API الخاص بمساحة عملك من OpenAI أو Anthropic، ويربطه المشرف من الإعدادات ← التكاملات، فتُحتسب تكلفة الاستخدام على حسابك.",
            ],
          },
        ],
      },
      {
        id: "pricing",
        nav: "السعر والمنشأ",
        title: "سي آر إم عربي من السعودية، بالريال السعودي.",
        blocks: [
          {
            kind: "p",
            text: [
              "Revenue Engine من تطوير [Sirdab](company)، وهي شركة سعودية، ومنشور مفتوح المصدر برخصة [MIT](license).",
              "النسخة المستضافة مجانية لأول ثلاثة أشهر، ثم **24.91 ر.س لكل مقعد شهريًا، تُدفع سنويًا** (299 ر.س لكل مقعد في السنة). والنسخة مفتوحة المصدر مجانية لتشغيلها على خوادمك: راجع [دليل الاستضافة الذاتية](self-hosted-crm) أو صفحة [برنامج CRM مجاني](free-crm) للمقارنة بين الخيارين.",
            ],
          },
          {
            kind: "fine",
            text: "غير متاح حاليًا: مزامنة البريد الوارد أو التقويم، والسلاسل البريدية، وعروض الأسعار والفواتير، وتطبيقات الجوال الأصلية (هو تطبيق ويب متجاوب)، والدخول الموحّد، ومفاتيح الواجهة البرمجية العامة.",
          },
        ],
      },
    ],
    faqTitle: "أسئلة عن البرنامج العربي.",
    faq: [
      {
        q: "هل البرنامج يدعم اللغة العربية بالكامل؟",
        a: [
          "التطبيق متاح بالعربية والإنجليزية، وفي العربية تنعكس الواجهة كلها من اليمين إلى اليسار: التنقل واللوحات والجداول والنماذج. بعض شاشات الإعداد الخاصة بالمدير ما زالت بالإنجليزية فقط.",
        ],
      },
      {
        q: "هل يستطيع فريقي استخدام برنامج CRM عربي بالإنجليزية أيضًا؟",
        a: [
          "نعم. يختار كل شخص لغته ويستطيع التبديل في أي وقت، فيعمل المتحدثون بالعربية والإنجليزية في مساحة العمل نفسها.",
        ],
      },
      {
        q: "هل أكتب أسماء السجلات بالعربية والإنجليزية معًا؟",
        a: [
          "نعم. يمكن تسمية الصفقات والأشخاص والمنظمات بأي من اللغتين، ويُعرض كل اسم باتجاهه الصحيح بجوار غيره.",
        ],
      },
      {
        q: "هل يفهم مساعد الذكاء الاصطناعي في برنامج CRM عربي الأسئلة بالعربية؟",
        a: [
          "نعم. يمكنك سؤاله عن خط مبيعاتك بالعربية أو الإنجليزية. «اسأل الذكاء الاصطناعي» في طور التجربة، وللقراءة فقط، ويعمل بمفتاح API الخاص بمساحة عملك من OpenAI أو Anthropic.",
        ],
      },
      {
        q: "كم تكلفة البرنامج؟",
        a: [
          "النسخة المستضافة مجانية لأول ثلاثة أشهر، ثم 24.91 ر.س لكل مقعد شهريًا، تُدفع سنويًا دفعة واحدة قدرها 299 ر.س لكل مقعد. والنسخة مفتوحة المصدر مجانية للاستضافة الذاتية.",
        ],
      },
    ],
  },
};
