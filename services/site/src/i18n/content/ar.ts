import type { ContentOverlay } from "./source"

export const content = {
  products: {
    desktop: {
      name: "Desktop",
      body: "جلسات وعلامات تبويب وفروق ومتصفّح مدمج وإضافات على macOS وWindows وLinux.",
      action: "تنزيل",
    },
    mobile: { name: "Mobile", body: "ابدأ جلساتك ووجّهها وامنح الموافقات من هاتفك أينما كنت.", action: "تنزيل" },
    terminal: { name: "Terminal", body: "واجهة طرفية سريعة لأي shell أو محرّر أو خادم بعيد.", action: "تثبيت" },
    sdk: { body: "تحكّم في OpenCode من سكربتاتك ومهام CI وأدواتك.", action: "اقرأ الوثائق" },
    mini: { body: "واجهة طرفية بسيطة تعرض الردود في سجل التمرير، مع سطر واحد لإدخال المطالبات أسفلها.", action: "تثبيت" },
  },
  productDetails: {
    desktop: {
      title: "OpenCode | تطبيق سطح المكتب لأنظمة macOS وWindows وLinux",
      description:
        "شغّل ما شئت من وكلاء OpenCode بالتوازي، وشاهد كل تغيير في متصفّح بجوارهم، وتابع عملهم من أي جهاز. لأنظمة macOS وWindows وLinux.",
      intro:
        "شغّل عدة وكلاء معًا، مع علامة تبويب لكل جلسة. راجع فروق كل تعديل، وعلّق على أي سطر، وعاين النتيجة في المتصفّح المدمج. متاح لأنظمة macOS وWindows وLinux.",
      showcase: {
        "parallel-agents": {
          title: "وكلاء بالتوازي",
          body: "شغّل عدد الوكلاء الذي تريده ودعهم يعملون جميعًا بالتوازي. تنقّل بينهم كلما أنهى أحدهم عمله.",
        },
        "see-it-in-the-browser": {
          title: "شاهده في المتصفح",
          body: "يُفتح تطبيقك في متصفّح بجوار الوكيل، لترى أنت والوكيل كل تغيير فور حدوثه.",
        },
        "on-every-device": {
          title: "على كل أجهزتك",
          body: "شغّل الوكلاء على جميع أجهزتك، وتابعهم من تطبيق سطح المكتب أو الطرفية أو هاتفك.",
        },
        "extend-it": {
          title: "وسّعه",
          body: "اربط أدواتك وخدماتك لتمكّن الوكيل من العمل مع أيٍّ منها، أو دع OpenCode ينشئ ملحقات لنفسه لها واجهاتها الخاصة في الشريط الجانبي.",
        },
      },
    },
    mobile: {
      title: "OpenCode | Mobile، جلسات البرمجة على هاتفك",
      description:
        "ابدأ جلسات OpenCode ووجّهها من هاتفك. تحدّث إلى الوكيل أثناء عمله على حاسوبك.",
      intro:
        "ابدأ جلساتك ووجّهها من هاتفك أينما كنت. اتصل بجلسة لتتحدّث إلى الوكيل، أو افتح أي جلسة وتابع من حيث توقّفت. كل ذلك عبر OpenCode، وهو يعمل على حاسوبك.",
      features: {
        "notify-when-done": { title: "إشعار عند الانتهاء", body: "احصل على ملخص قصير عند انتهاء جلسة بدأتها." },
        "pair-from-anywhere": { title: "اربط من أي مكان", body: "اتصل من أي شبكة عبر opencode pair --remote." },
        "every-computer": { title: "كل حواسيبك", body: "تنقّل بين الحواسيب التي ربطتها بلمسة واحدة." },
        "siri-and-shortcuts": { title: "Siri والاختصارات", body: "ابدأ مكالمة أو جلسة من Siri أو مركز التحكم." },
        "follow-along": { title: "تابع العمل", body: "شاهد الخط الزمني يتحدّث أثناء عمل الوكيل." },
        "your-computer": { title: "حاسوبك", body: "يتصل بـ OpenCode الذي يعمل على جهازك الخاص." },
        "share-sheet": { title: "قائمة المشاركة", body: "شارك أي شيء مع جلسة دون فتح التطبيق." },
        "mute-sessions": { title: "كتم الجلسات", body: "أبقِ الجلسة في قائمتك دون تلقي إشعاراتها." },
      },
      showcase: {
        voice: { title: "الصوت", body: "اتصل بجلسة وقل ما تحتاج إليه. يردّ عليك الوكيل صوتيًا." },
        results: { title: "النتائج", body: "يخبرك الوكيل في المكالمة بما تغيّر فور انتهاء العمل الذي طلبته." },
        sessions: { title: "الجلسات", body: "افتح أي جلسة لترى أين وصلت، ثم أكمل من حيث توقفت." },
      },
    },
    terminal: {
      title: "OpenCode | واجهة طرفية لوكيل البرمجة مفتوح المصدر",
      description:
        "واجهة طرفية سريعة لـ OpenCode تعمل في أي shell أو محرّر أو خادم بعيد. صِف ما تريد، وراجع فروق كل تعديل، ووافق على الأوامر.",
      intro:
        "واجهة طرفية سريعة لأي shell أو محرّر أو خادم بعيد. صِف ما تريد بكلمات بسيطة، وشاهد فروق كل تعديل فور إجرائه، وحدّد الأوامر التي تُشغّل تلقائيًا.",
      features: {
        "any-terminal": { title: "أي طرفية", body: "تعمل في أي shell، أو في طرفية محرّرك، أو على خادم بعيد." },
        "diffs-in-the-timeline": {
          title: "الفروق في الخط الزمني",
          body: "شاهد فروق كل تعديل في الخط الزمني لحظة إجرائه.",
        },
        "pick-up-later": { title: "أكمل لاحقًا", body: "تابع آخر جلسة بالخيار \u2066-c\u2069، أو أي جلسة بالخيار \u2066-s\u2069." },
        "one-off-runs": { title: "تشغيل لمرة واحدة", body: "يرسل الأمر \u2066opencode run\u2069 رسالة واحدة ويطبع الرد." },
        "agents-and-commands": {
          title: "وكلاء وأوامر",
          body: "بدّل الوكلاء عبر shift+tab وافتح كل الأوامر عبر ctrl+p.",
        },
        "auto-approve": { title: "موافقة تلقائية", body: "استخدم الخيار \u2066--auto\u2069 للسماح بكل إجراء لم ترفضه." },
        "any-server": { title: "أي خادم", body: "اتصل بخادم OpenCode باستخدام عنوان URL مع الخيار \u2066--server\u2069." },
        "usage-stats": { title: "إحصاءات الاستخدام", body: "يعرض الأمر \u2066opencode stats\u2069 إحصاءات استخدام قابلة للمشاركة." },
      },
      showcase: {
        "ask-in-plain-words": { title: "اطلب بكلمات بسيطة", body: "اكتب ما تريد، ويعرض الوكيل خطته أثناء العمل." },
        "approve-what-runs": { title: "وافق على الأوامر", body: "تظهر فروق التعديلات، ولا تُنفّذ الأوامر إلا بإذنك." },
        "make-it-yours": { title: "خصّص واجهتك", body: "بدّل السمة بضغطة مفتاح. اختر السمة الافتراضية أو tokyonight أو أي سمة أخرى." },
        mini: { title: "Mini", body: "شغّل \u2066opencode mini\u2069 لتظهر الردود في سجل التمرير." },
      },
    },
    sdk: {
      title: "OpenCode | TypeScript SDK للسكربتات ومهام CI والأدوات",
      description:
        "تحكّم في OpenCode من سكربتاتك ومهام CI وأدواتك. ينشئ عميل TypeScript ذو الأنواع المحدّدة الجلسات، ويرسل المطالبات، ويبثّ كل حدث لحظة وقوعه.",
      intro:
        "تحكّم في OpenCode من سكربتاتك ومهام CI وأدواتك. مع SDK، يعمل OpenCode داخل عمليتك بإعداداتك ونماذجك. ويتيح لك العميل ذو الأنواع المحدّدة إنشاء الجلسات وإرسال المطالبات وبثّ كل حدث.",
      features: {
        "typescript-client": { title: "عميل TypeScript", body: "طلبات وأحداث ذات أنواع محدّدة بالقيم نفسها في @opencode/client." },
        "sessions-from-code": { title: "جلسات من الكود", body: "أنشئ الجلسات وأرسل المطالبات من أي سكربت." },
        "any-model": { title: "أي نموذج", body: "يستخدم النماذج المضبوطة في إعداد OpenCode لديك." },
        "npm-or-bun": { title: "npm أو bun", body: "ثبّته بالأمر \u2066npm i @opencode/sdk\u2069 أو \u2066bun add @opencode/sdk\u2069." },
        "in-process-host": { title: "مضيف داخل العملية", body: "يشغّل OpenCode في الذاكرة، دون المرور بالشبكة." },
        "your-plugins": { title: "ملحقاتك", body: "مرّر ملحقاتك عند إنشاء المضيف داخل العملية." },
        "promise-or-effect": { title: "Promise أو Effect", body: "تقدّم Promise API وEffect API القيم نفسها." },
        "cloudflare-workers": {
          title: "Cloudflare Workers",
          body: "شغّل OpenCode داخل Cloudflare Durable Object على Workers.",
        },
      },
      showcase: {
        "fix-ci-from-code": {
          title: "أصلح CI من الكود",
          body: "يطلب سكربت قصير من OpenCode إصلاح الاختبارات التي فشلت، ثم يعيد تشغيلها.",
        },
        "follow-every-step": {
          title: "تابع كل خطوة",
          body: "ابثّ الأحداث لترى كل أداة يستدعيها الوكيل لحظة استدعائها.",
        },
        "build-your-own-tools": {
          title: "ابنِ أدواتك",
          body: "اربط OpenCode بالروبوتات ولوحات المعلومات وسير العمل ببضعة أسطر.",
        },
        "in-your-process": { title: "داخل عمليتك", body: "يشغّل OpenCode داخل عمليتك، بإعداداتك ونماذجك." },
      },
    },
    mini: {
      title: "OpenCode | Mini، واجهة طرفية بسيطة للوكيل",
      description:
        "مع Mini، يعمل OpenCode في واجهة طرفية بسيطة. تظهر الردود في سجل تمرير الطرفية، ولا يبقى في الأسفل سوى سطر المطالبة وسطر الحالة.",
      intro:
        "واجهة طرفية بسيطة لـ OpenCode. شغّل \u2066opencode mini\u2069 لتظهر الردود مباشرةً في سجل تمرير الطرفية، فتتصفّحها وتبحث فيها وتنسخها كأي مخرجات أخرى. لا يبقى في الأسفل سوى سطر المطالبة وسطر الحالة.",
      features: {
        "your-scrollback": { title: "سجل التمرير", body: "تصبح الردود جزءًا عاديًا من سجل الطرفية." },
        "one-prompt": { title: "سطر واحد للمطالبة", body: "الوكيل والنموذج والسياق والتكلفة في سطر حالة واحد." },
        permissions: { title: "الأذونات", body: "اسمح بالتعديلات والأوامر من منطقة الإدخال." },
        "how-much-shows": { title: "تحكّم في التفاصيل", body: "اختر عرضًا هادئًا أو افتراضيًا أو كاملًا للاستدلال ومخرجات الأدوات." },
        "pick-up-later": { title: "أكمل لاحقًا", body: "تابع آخر جلسة بالخيار \u2066-c\u2069، أو أي جلسة بالخيار \u2066-s\u2069." },
        "same-opencode": { title: "OpenCode نفسه", body: "الخادم والوكلاء والنماذج نفسها في التطبيقات الأخرى." },
        agents: { title: "الوكلاء", body: "بدّل الوكلاء من سطر المطالبة مباشرةً." },
        compact: { title: "ضغط السياق", body: "اختصر سياق جلسة طويلة بالأمر \u2066/compact\u2069." },
      },
    },
  },
  extensionCard: {
    name: "الإضافات",
    body: "استخدم OpenCode داخل VS Code، أو في Zed ومحررات أخرى عبر ACP.",
    action: "تثبيت",
  },
  extensions: {
    browse: {
      body: "دع الوكلاء يستخدمون متصفحك الحقيقي.",
      title: "OpenCode | Browse، متصفحك الحقيقي لوكلاء البرمجة",
      description:
        "يتيح Browse لـ OpenCode وعملاء MCP الآخرين استخدام متصفّحك الفعلي. يقرأ الوكلاء الصفحات وينقرون ويكتبون ويلتقطون صور الشاشة ويسجّلون علامات التبويب، ويتركون لك تسجيل الدخول والمصادقة بعاملين (2FA).",
      intro:
        "خادم MCP وإضافة Chromium يتيحان لوكلائك العمل في متصفّحك الفعلي، بعلامات تبويبك وحساباتك المسجّل دخولها وإضافاتك. يفتح الوكلاء علامات تبويب مجمّعة في الخلفية كي لا تعيق عملك. يقرؤون الصفحات وينقرون ويكتبون ويلتقطون صور الشاشة ويسجّلون علامات التبويب. وعند تسجيل الدخول أو المصادقة بعاملين (2FA) أو الدفع، يعيدون إليك التحكّم في علامة التبويب ويتابعون عند النقر على Continue.",
      features: {
        "your-real-browser": {
          title: "متصفحك الحقيقي",
          body: "Chrome وEdge وBrave وArc وHelium وVivaldi وOpera وChromium.",
        },
        "out-of-your-way": {
          title: "من دون مقاطعة عملك",
          body: "تُفتح علامات تبويب الوكلاء في الخلفية، في مجموعات مطوية.",
        },
        handoffs: { title: "التحكّم عند الحاجة", body: "سجّل الدخول أو أكمِل المصادقة بعاملين (2FA) بنفسك، ثم انقر على Continue." },
        "lend-a-tab": { title: "أعِر علامة تبويب", body: "انقر زر شريط الأدوات لتسليم الوكيل علامة تبويب مفتوحة." },
        "record-and-capture": { title: "لقطات وتسجيلات", body: "لقطات شاشة وتسجيلات لعلامات التبويب وحركة الشبكة." },
        "any-mcp-client": { title: "أي عميل MCP", body: "OpenCode وClaude Code وCursor وCodex وZed وغيرها الكثير." },
        "all-your-logins": {
          title: "حساباتك مفتوحة كما هي",
          body: "يستخدم الوكلاء المواقع التي سجّلت الدخول إليها بالفعل. بلا مفاتيح ولا إعداد.",
        },
        "allowed-sites": { title: "المواقع المسموح بها", body: "احصر تصفّح الوكيل في المواقع التي تحدّدها." },
      },
      install:
        "ثبّت [إضافة Chrome] أولًا، وسترشدك إلى بقية الخطوات. وإن احتجت إلى تثبيت CLI مباشرةً، وهو غير ضروري عادةً، فاستخدم أحد هذه الأوامر.",
    },
  },
  apps: {
    browse: {
      category: "التحكم في المتصفح للوكلاء",
      body: "دع وكيلك يستخدم متصفحك الحقيقي، مع تسجيلات دخولك وعلامات التبويب.",
    },
    opentunnel: { category: "أنفاق محلية", body: "عناوين HTTPS عامة للتطبيقات المحلية." },
    opentui: { category: "مكتبة", body: "مكتبة لواجهات المستخدم في الطرفية." },
    hex: { category: "إملاء صوتي", body: "إملاء صوتي على الجهاز لأي تطبيق." },
  },
  getStarted: {
    title: "ابدأ الآن",
    lead: "أسهل طريقة للبدء هي أن تنزّل OpenCode وتستخدم النماذج المجانية. لا حاجة إلى حساب. وللمزيد، استخدم اشتراكك الخاص أو OpenCode Go.",
    phrases: {
      "download-opencode": { text: "تنزّل OpenCode" },
      "free-models": { text: "النماذج المجانية" },
      "your-own-subscription": { text: "اشتراكك الخاص" },
      "a-subscription-you-already-have": { text: "اشتراك لديك بالفعل" },
      "opencode-go": { text: "OpenCode Go" },
    },
    subscriptions: { "chatgpt-plus-pro": { name: "ChatGPT Plus/Pro" } },
    steps: {
      download: { title: "نزّل", line: "Desktop أو Terminal أو Mobile." },
      "use-free-models": {
        title: "استخدم النماذج المجانية",
        line: "يضم OpenCode مجموعة من النماذج المجانية. لا حاجة إلى حساب.",
      },
      "add-more-models": {
        title: "أضف نماذج أخرى",
        line: "استخدم اشتراكك الحالي، أو اختر نماذج OpenCode Go بسعر يبدأ من \u2066$10\u2069 شهريًا.",
      },
    },
    sentence: "نزّل OpenCode، وابدأ بالنماذج المجانية، واستخدم اشتراكك الخاص أو OpenCode Go عندما تريد المزيد.",
  },
  byos: {
    title: "استخدم اشتراكك الحالي",
    headline: "استخدم الاشتراكات التي لديك بالفعل.",
    line: "سجّل الدخول عبر ChatGPT Plus أو Pro، أو GitHub Copilot. أو استخدم اشتراك OpenCode.",
    yours: { label: "اشتراكك", items: { "chatgpt-plus-pro": { name: "ChatGPT Plus/Pro" } } },
    planLinks: ["اشتراك OpenCode", "OpenCode Go"],
    ours: { label: "خطط OpenCode" },
  },
  brand: {
    hero: { copy: { text: "قواعد الاستخدام للوكيل", copied: "نُسخت القواعد" } },
    naming: {
      title: "التسمية",
      body: "اكتب OpenCode كلمة واحدة، بحرف O كبير وحرف C كبير. لا تكتب Opencode أو Open Code أو OpenCode AI أو Open-Code.",
      code: "استخدم `opencode` بالأحرف الصغيرة فقط في الكود وأسماء الحزم، مثل `opencode-figma` أو `@acme/opencode-plugin`.",
    },
    families: {
      logo: {
        title: "الشعار",
        body: "استخدم الشعار وحده لأيقونات التطبيقات والصور الرمزية وغيرها من المساحات الصغيرة. تتضمّن النسخ المربّعة هوامش إضافية للواجهات التي تقتصّ الصور على شكل مربّع.",
        assets: {
          light: { name: "فاتح" },
          dark: { name: "داكن" },
          "square-light": { name: "مربع، فاتح" },
          "square-dark": { name: "مربع، داكن" },
        },
      },
      wordmark: {
        title: "الشعار النصي",
        body: "الاسم الكامل مرسوم بحروف OpenCode المميّزة. استخدمه حيث تتّسع المساحة للاسم كاملًا.",
        assets: { light: { name: "فاتح" }, dark: { name: "داكن" } },
      },
      "simple-wordmark": {
        title: "شعار نصي بسيط",
        body: "نسخة أحادية اللون من الشعار النصي، للطباعة والتطريز والأماكن التي لا تسمح إلا بلون واحد.",
        assets: { light: { name: "فاتح" }, dark: { name: "داكن" } },
      },
    },
    icons: {
      title: "الصور الرمزية",
      body: "صور رمزية مربّعة بحجم 1024px لحسابات Slack وDiscord وGitHub وغيرها. تملأ الخلفية المربّع، ويبقى الشعار داخل حدود الدائرة بهامش كافٍ ليظهر كاملًا بعد الاقتصاص الدائري.",
      items: { dark: { name: "داكن" }, light: { name: "فاتح" } },
    },
    colors: {
      title: "الألوان",
      body: "يعتمد الشعار والشعار النصي على لون حبر واحد بثلاث درجات من العتامة، مع لون أفتح للخلفيات الداكنة. هذه قيم الألوان في الملفات القياسية. استخدمها للشعار والشعار النصي فقط، لا لنصوص أو خلفيات أخرى. انقر على أي قيمة لنسخها.",
      palettes: {
        light: {
          name: "فاتح",
          swatches: {
            ink: { name: "الحبر", use: "إطار الشعار وحروف «code»." },
            "ink-70": { name: "الحبر 70%", use: "حروف «open».", ink: "الحبر بعتامة 70%." },
            "ink-20": { name: "الحبر 20%", use: "الظل الداخلي للشعار.", ink: "الحبر بعتامة 20%." },
          },
        },
        dark: {
          name: "داكن",
          swatches: {
            ink: { name: "الحبر", use: "إطار الشعار وحروف «code»." },
            "ink-72": { name: "الحبر 72%", use: "حروف «open».", ink: "الحبر بعتامة 72%." },
            "ink-28": { name: "الحبر 28%", use: "الظل الداخلي للشعار.", ink: "الحبر بعتامة 28%." },
          },
        },
      },
    },
    variants: {
      title: "النسخ",
      body: "اختر النسخة التي تُبقي الشعار واضحًا على خلفيتك، الداكنة على الخلفيات الفاتحة والفاتحة على الداكنة. الشعار والشعار النصي ملفان منفصلان، فاستخدم أحدهما فقط.",
      groups: {
        default: {
          name: "الافتراضية",
          body: "هذا هو الشعار المناسب لمعظم الاستخدامات. تظليله الداخلي شفّاف، فيطابق النسخ الرمادية ثنائية الدرجة على خلفية بيضاء أو سوداء، ويُظهر ما وراءه على الصور والتدرّجات والخلفيات الملوّنة.",
          rows: {
            logo: { title: "الشعار", tiles: { dark: { name: "داكن" }, light: { name: "فاتح" } } },
            wordmark: { title: "الشعار النصي", tiles: { dark: { name: "داكن" }, light: { name: "فاتح" } } },
          },
        },
        simple: {
          name: "البسيطة",
          body: "لون واحد مع فراغات مفتوحة داخل الحروف، بلا تظليل داخلي. استخدم هذه النسخة على خلفيات بلون موحّد أو للطباعة بلون واحد أو حين يتعذّر استخدام النسخ الرمادية. اختر النسخة الداكنة للألوان الفاتحة، والفاتحة للألوان الداكنة.",
          rows: { wordmark: { title: "الشعار النصي", tiles: { dark: { name: "داكن" }, light: { name: "فاتح" } } } },
        },
      },
    },
    usage: {
      title: "الاستخدام",
      body: "استخدم النسخ الفاتحة على الخلفيات الفاتحة والنسخ الداكنة على الخلفيات الداكنة. الشعار والشعار النصي منفصلان، فاستخدم أحدهما ولا تستخدمهما معًا أبدًا.",
      stroke: {
        title: "خط واحد",
        body: "تُقاس قواعد المسافات في هذه الصفحة بالخطوط. الخط الواحد هو سُمك إطار الشعار، أي ربع عرضه، فيكون عرض الشعار 4 خطوط وارتفاعه 5 خطوط.",
      },
      clearSpace: {
        title: "المساحة الفارغة",
        body: "اترك مساحة لا تقل عن خطين على كل جانب من الشعار والشعار النصي. في الشعار، الخط هو سُمك إطاره، أي ربع عرضه. وفي الشعار النصي، هو سُمك حروفه، أي سُبع ارتفاعه.",
      },
      pixels: {
        title: "بكسلات كاملة",
        body: "نسبة أبعاد الشعار ثابتة عند \u20664:5\u2069، وسُمك الخط ربع عرضه. غيّر الحجم بمضاعفات \u20664 × 5px\u2069 لتقع كل حافة وكل خط على بكسل كامل.",
        do: "حاذِ كل حافة والخط بسُمك 4px مع البكسلات الكاملة.",
        dont: "تغيير حجم الشعار دون الحفاظ على نسبة \u20664:5\u2069 يجعل الحواف تقع بين البكسلات فتفقد وضوحها.",
        sizes: { logo: { title: "الشعار" }, wordmark: { title: "الشعار النصي" } },
      },
      minimumTitle: "أصغر الأحجام",
      minimum: {
        logo: { title: "الشعار", body: "الحد الأدنى \u206616 × 20px\u2069، بسُمك خط 4px. يفقد الشعار وضوحه عند تصغيره أكثر." },
        wordmark: { title: "الشعار النصي", body: "الحد الأدنى \u2066117 × 21px\u2069، بسُمك خط 3px. يفقد الشعار وضوحه عند تصغيره أكثر." },
      },
    },
    donts: {
      title: "تجنّب",
      body: "أخطاء شائعة تجنّبها عند استخدام الشعار والشعار النصي.",
      examples: {
        "two-tone": { caption: "إعادة تلوين الشعار بألوان أخرى." },
        bright: { caption: "استخدام لون ساطع واحد." },
        gradient: { caption: "ملء الشعار بتدرّج لوني." },
        inverted: { caption: "عكس درجات اللون." },
        stretch: { caption: "تمديد الشعار أو ضغطه." },
        shadow: { caption: "إضافة ظلال مسقطة." },
        glow: { caption: "إضافة توهّج أو حدود." },
        lockup: { caption: "وضع كلمات أخرى بجوار الشعار." },
        "low-contrast": { caption: "وضع رمادي على رمادي بتباين ضعيف." },
        color: { caption: "وضع الشعار الرمادي ثنائي الدرجة على خلفية ملوّنة تبهت معها درجات الرمادي." },
      },
    },
    integrations: {
      title: "التكاملات",
      body: "يمكن للملحقات والمزوّدين والأدوات التي تعمل مع OpenCode، والمشاريع المبنية به، أن تذكر ذلك. استخدم شارة أو شعارًا مشتركًا، وسمِّ مشروعك بحيث يتضح أنه لك.",
      badges: {
        body: "ضع شارة في ملف README أو الوثائق أو موقعك واربطها بـ opencode.ai. اختر الملف الفاتح أو الداكن حسب خلفيتك (تتبدّل نسخة HTML تلقائيًا)، ولا تغيّر الألوان أو النص.",
        sizes: "يتوفر كل نمط بأحجام 20 و32 و44px (Shields بحجم 20px فقط)، بصيغة SVG وبصيغة PNG بدقة 2×.",
        mono: "يتوفّر كل ملف أيضًا بنص بخط OpenMono. أضف \u2066-mono\u2069 قبل امتداد الملف، كما في \u2066opencode-works-with-a-light-20-mono.svg\u2069، أو أضف \u2066-mono-caps\u2069 لاستخدام OpenMono بأحرف كبيرة.",
        groups: {
          "works-with": {
            title: "يعمل مع",
            alt: "يعمل مع OpenCode",
            body: "للملحقات والمزوّدين والأدوات التي تعمل مع OpenCode.",
          },
          "built-with": { title: "مبني بـ", alt: "مبني بـ OpenCode", body: "للمشاريع المصنوعة بـ OpenCode." },
        },
        styles: { a: { name: "إطار" }, c: { name: "خلايا" }, f: { name: "مصمت" }, g: { name: "Shields" } },
      },
      lockup: {
        title: "الشعار المشترك",
        body: "ضع شعار OpenCode وشعار الشريك جنبًا إلى جنب، وبينهما ×. اترك مسافة 3 خطوط على كل جانب من ×، واجعل شعار الشريك يبدو بطول شعار OpenCode، وحافظ على مساحة فارغة حول الشعار المشترك كله.",
      },
      naming: {
        title: "تسمية مشروعك",
        body: "ابدأ باسمك أنت، حتى يتضح أن المشروع لك.",
        rule: "اكتب `Linear for OpenCode` أو سمِّ الحزمة `opencode-linear`. لا تكتب `OpenCode Linear` أو `Linear by OpenCode`.",
      },
    },
    trademarks: {
      title: "العلامات التجارية",
      body: "OpenCode وشعار OpenCode علامتان تجاريتان لـ Anomaly. لا تستخدمهما للإيحاء بأن Anomaly تؤيدك أو ترعاك، ولا في اسم منتجك أو شركتك، ولا على البضائع دون إذن.",
      contact: { before: "للأسئلة، راسلنا على ", after: "." },
    },
  },
  press: {
    title: "OpenCode | ملف صحفي يتضمّن معلومات الشركة وملفات العلامة",
    description:
      "الملف الصحفي لـ OpenCode. معلومات عن OpenCode والشركة المطوّرة له Anomaly، وشعارات وشعارات نصية للتنزيل، وجهة تواصل للاستفسارات الصحفية.",
    hero: { title: "الصحافة", body: "معلومات وملفات العلامة وبيانات التواصل للكتابة عن OpenCode وAnomaly." },
    company: {
      title: "عن Anomaly",
      lead: "Anomaly هي الشركة التي تقف وراء OpenCode. تبني أدوات مفتوحة المصدر للمطورين.",
      more: "من مشاريعها الأخرى SST وOpenTUI، وكلها مفتوحة المصدر على [GitHub](github).",
      learnMore: "لمعرفة المزيد، زُر [anoma.ly](site).",
      projects: {
        opencode: {
          body: "وكيل البرمجة مفتوح المصدر، مع تطبيقات لسطح المكتب والطرفية والهاتف، وSDK. مرخّص بـ MIT، وأكثر من 220,000 نجمة على GitHub.",
        },
        sst: {
          body: "إطار عمل لبناء تطبيقات متكاملة على بنيتك التحتية. مفتوح المصدر منذ 2020 بترخيص MIT، ويحظى بأكثر من 26,000 نجمة على GitHub.",
        },
        opentui: {
          name: "OpenTUI",
          body: "مكتبة لواجهات الطرفية بـ TypeScript أو React أو Solid، بنواة مكتوبة بـ Zig. يستخدمها OpenCode في الإنتاج. أكثر من 13,000 نجمة على GitHub.",
        },
        "models-dev": {
          body: "قاعدة بيانات مفتوحة المصدر لمواصفات نماذج AI وأسعارها وقدراتها، مع API عامة. تضم أكثر من 8,900 نموذج من أكثر من 200 مزوّد.",
        },
        hex: {
          body: "إملاء صوتي لأنظمة Mac وWindows وLinux. يحوّل Hex الكلام إلى نص على جهازك ويلصقه في أي تطبيق، فلا يغادر الصوت جهازك أبدًا.",
        },
        opentunnel: {
          body: "CLI وSDK يمنحان التطبيقات على جهازك عنوان URL عامًا عبر HTTPS. تنتهي جلسة TLS على جهازك، فلا يرى الوسيط البيانات غير المشفّرة أبدًا.",
        },
      },
    },
    about: {
      title: "عن OpenCode",
      body: "أوصاف OpenCode ومنتجاته بنسختين طويلة وقصيرة، جاهزة للنسخ.",
      boilerplate: {
        long: "OpenCode وكيل برمجة مفتوح المصدر. يتوفر كتطبيق لسطح المكتب وواجهة طرفية وتطبيق للهاتف وSDK، ويعمل مع نماذج من أي مزوّد، منها Claude وGPT وGemini. OpenCode مرخّص بـ MIT ومن صنع Anomaly. لديه أكثر من 220,000 نجمة على GitHub وأكثر من 1,000 مساهم، ويستخدمه أكثر من 22 مليون مطوّر كل شهر.",
        short: "OpenCode وكيل برمجة مفتوح المصدر من Anomaly، مع تطبيقات لسطح المكتب والطرفية والهاتف، وSDK.",
      },
      products: {
        "opencode-console": {
          name: "OpenCode Console",
          long: "OpenCode Console هو تطبيق الويب الذي يشتري فيه المطورون والفرق الوصول إلى نماذج AI ويديرونه لـ OpenCode ووكلاء البرمجة الآخرين. يقدّم استدلالًا بالدفع حسب الاستخدام للنماذج المتقدمة ومفتوحة الأوزان، يُحتسب لكل طلب من رصيد مدفوع مسبقًا، إضافة إلى اشتراكات OpenCode Go. تحصل الفرق على مساحات عمل بأدوار Member وAdmin وOwner، وحدود إنفاق لمساحة العمل ولكل مستخدم، وتسجيل دخول موحّد عبر Okta أو Microsoft Entra ID أو Google Workspace، وSCIM. يدعم Console أكثر من 30 مزوّدًا، فتستطيع الفرق ربط حسابات المزوّدين التي لديها، والاستدلال الخاص به اختياري. عنوانه opencode.ai/console.",
          short:
            "OpenCode Console هو تطبيق الويب من Anomaly للوصول إلى نماذج AI بالدفع حسب الاستخدام، واشتراكات OpenCode Go، وضوابط الفرق مثل الميزانيات وتسجيل الدخول الموحّد.",
        },
        "opencode-go": {
          long: "OpenCode Go اشتراك للمطوّرين الذين يريدون سعرًا شهريًا ثابتًا لنماذج البرمجة. سعر Go هو \u2066$10\u2069 شهريًا، وGo Plus بسعر \u2066$40\u2069 شهريًا بحدود أعلى، وGo Teams بسعر \u2066$20\u2069 شهريًا لكل عضو. تضم كل خطة نماذج مختارة ومختبَرة للبرمجة بالوكلاء. لكل نموذج حد استخدام شهري بالدولار، مع حصص تُحتسب على فترات متجدّدة تبلغ 20% من الحد الشهري لكل 5 ساعات و50% لكل أسبوع. يمكن للمشتركين شحن الرصيد ومواصلة العمل من رصيد الدفع حسب الاستخدام والإلغاء في أي وقت. يعمل Go مع OpenCode ووكلاء آخرين. عنوانه opencode.ai/console/go.",
          short:
            "OpenCode Go اشتراك شهري من Anomaly يتيح للمطوّرين استخدام نماذج برمجة مختارة ضمن حدود شهرية، بسعر يبدأ من \u2066$10\u2069 شهريًا.",
        },
        "opencode-data": {
          name: "OpenCode Data",
          long: "OpenCode Data لوحة معلومات عامة توضّح نماذج AI التي يستخدمها المطوّرون في OpenCode وكيف يتغيّر توزيع الاستخدام بمرور الوقت. تعرض ترتيب النماذج الأكثر استخدامًا، واستهلاك الرموز، وتكاليف الجلسات والرموز، ونسب التخزين المؤقت، والحصة السوقية، وتوزيعًا حسب الدولة. تُجمّع الأرقام كل ساعة، وتُحتسب الأيام والأسابيع بتوقيت UTC. أعداد المستخدمين والجلسات تقريبية، وتستند التكاليف إلى الأسعار المعلنة في دليل نماذج OpenCode. يمكن للصحفيين الاستشهاد بهذه البيانات باسم OpenCode Data (opencode.ai/data)، مع ذكر وقت التحديث الظاهر في الصفحة.",
          short:
            "OpenCode Data لوحة معلومات عامة على opencode.ai/data ترتّب نماذج AI حسب الاستخدام الفعلي في OpenCode، مع الرموز والتكاليف والحصة السوقية المحدّثة كل ساعة.",
        },
      },
    },
    facts: {
      title: "لمحة سريعة",
      items: {
        license: { label: "الترخيص" },
        "first-release": { label: "الإصدار الأول" },
        "made-by": { label: "من صنع" },
      },
    },
    milestones: {
      title: "المحطات",
      items: {
        "first-release-v0-0-1": { date: "أبريل 2025", text: "الإصدار الأول، v0.0.1" },
        "1-million-downloads": { date: "أكتوبر 2025", text: "أكثر من 1 مليون تنزيل" },
        "opencode-1-0": { date: "أكتوبر 2025", text: "OpenCode 1.0" },
        "desktop-app-ships": { date: "ديسمبر 2025", text: "إطلاق تطبيق Desktop" },
        "10-million-downloads": { date: "يناير 2026", text: "أكثر من 10 ملايين تنزيل" },
        "opencode-2-0": { date: "سبتمبر 2026", text: "OpenCode 2.0" },
        "220-000-github-stars": { date: "نوفمبر 2026", text: "أكثر من 220,000 نجمة على GitHub" },
      },
    },
    news: {
      title: "أحدث الإصدارات",
      intro: "نُصدر تحديثات OpenCode باستمرار. إليك أحدث الإصدارات التي تقدّم ميزات جديدة.",
      changelog: { text: "سجل التغييرات الكامل" },
      feed: { text: "موجز RSS" },
    },
    media: {
      title: "الوسائط",
      intro: "صور ومقاطع قصيرة التُقطت من كل تطبيق كما هو. يمكنك استخدامها في موادك عن OpenCode.",
      note: "كل اللقطات بالسمة الداكنة. الصور وصور معاينة الفيديو بصيغة JPG حتى \u20661920 × 1080\u2069، أو \u20661080 × 1350\u2069 للصور العمودية. المقاطع بصيغة MP4 من دون صوت.",
      products: {
        desktop: {
          name: "Desktop",
          items: {
            "locked-landscape": { title: "فيديو Desktop" },
            "frame-1": { title: "صورة Desktop 1" },
            "frame-2": { title: "صورة Desktop 2" },
            "frame-3": { title: "صورة Desktop 3" },
            "frame-4": { title: "صورة Desktop 4" },
            "feature-1": { title: "وكلاء بالتوازي" },
            "feature-2": { title: "شاهده في المتصفّح" },
            "feature-3": { title: "على كل أجهزتك" },
            "locked-portrait": { title: "فيديو Desktop، عمودي" },
          },
        },
        mobile: {
          name: "Mobile",
          items: {
            "locked-landscape": { title: "فيديو Mobile" },
            "frame-1": { title: "صورة Mobile 1" },
            "frame-2": { title: "صورة Mobile 2" },
            "frame-3": { title: "صورة Mobile 3" },
            "feature-1": { title: "الصوت" },
            "feature-2": { title: "الجلسات" },
            "feature-3": { title: "النتائج" },
            "locked-portrait": { title: "فيديو Mobile، عمودي" },
          },
        },
        terminal: {
          name: "Terminal",
          items: {
            "locked-landscape": { title: "فيديو Terminal" },
            "frame-1": { title: "صورة Terminal 1" },
            "frame-2": { title: "صورة Terminal 2" },
            "frame-3": { title: "صورة Terminal 3" },
            "frame-4": { title: "صورة Terminal 4" },
            "feature-1": { title: "اطلب بكلمات بسيطة" },
            "feature-2": { title: "وافق على الأوامر" },
            "feature-3": { title: "خصّص واجهتك" },
            "locked-portrait": { title: "فيديو Terminal، عمودي" },
          },
        },
        sdk: {
          items: {
            "locked-landscape": { title: "فيديو SDK" },
            "frame-1": { title: "صورة SDK 1" },
            "frame-2": { title: "صورة SDK 2" },
            "frame-3": { title: "صورة SDK 3" },
            "frame-4": { title: "صورة SDK 4" },
            "feature-1": { title: "أصلح CI من الكود" },
            "feature-2": { title: "تابع كل خطوة" },
            "feature-3": { title: "ابنِ أدواتك" },
            "locked-portrait": { title: "فيديو SDK، عمودي" },
          },
        },
      },
    },
    people: { title: "الأشخاص" },
    anomalyLogo: {
      title: "شعار Anomaly",
      body: "رمز Anomaly وشعارها النصي، بالأسود والأبيض. عرض ملفات PNG هو 2048 px.",
      assets: {
        "mark-black": { name: "الرمز، أسود" },
        "mark-white": { name: "الرمز، أبيض" },
        "wordmark-black": { name: "الشعار النصي، أسود" },
        "wordmark-white": { name: "الشعار النصي، أبيض" },
      },
      avatars: {
        body: "صور رمزية مربعة لحسابات X وGitHub وSlack وLinkedIn وغيرها. يقع الرمز داخل الدائرة بمسافة كافية، فيصمد أمام القص الدائري. عرض ملفات PNG هو 1024 و400 px.",
        items: {
          "avatar-dark": { name: "صورة رمزية، داكنة" },
          "avatar-light": { name: "صورة رمزية، فاتحة" },
        },
      },
      all: { text: "تنزيل الكل" },
    },
    coverage: { title: "التغطية" },
    brand: {
      title: "العلامة",
      before:
        "نزّل شعارات OpenCode وشعاراته النصية في ملف ZIP واحد. للملفات المنفردة والنسخ وقواعد الاستخدام، انتقل إلى ",
      link: { text: "صفحة العلامة" },
      after: ".",
      usage: "يمكنك استخدام هذه الملفات للكتابة عن OpenCode. لا تغيّرها، ولا توحِ بأن OpenCode يؤيد عملك.",
    },
    product: {
      title: "المنتج",
      items: {
        desktop: {
          name: "Desktop",
          body: "شغّل عدة وكلاء معًا، كلٌّ في علامة تبويب خاصة، على macOS وWindows وLinux. راجع فروق كل تعديل وعاين نتيجته.",
        },
        mobile: {
          name: "Mobile",
          body: "أحدث تطبيقات OpenCode. اتصل بجلسة لتتحدث مع الوكيل، ثم راجع تغييراته ووافق عليها من هاتفك، أينما كنت.",
        },
        terminal: {
          name: "Terminal",
          body: "واجهة طرفية لأي shell أو محرّر أو خادم بعيد. شاهد فروق كل تعديل واختر الأوامر التي تُشغّل تلقائيًا.",
        },
        sdk: {
          body: "عميل TypeScript ذو أنواع محدّدة للسكربتات ومهام CI وأدواتك. أنشئ الجلسات وأرسل المطالبات وابثّ كل حدث فور وقوعه.",
        },
      },
    },
    contact: {
      title: "التواصل",
      items: {
        press: { title: "الصحافة", body: "للصحفيين والمحللين. نردّ على طلبات وسائل الإعلام فقط." },
        support: {
          title: "الدعم",
          body: "للمساعدة في استخدام OpenCode، أبلغ عن المشكلة أو اسأل المجتمع. لاستفسارات الحساب والفوترة، راسلنا.",
          links: { "github-issues": { text: "البلاغات على GitHub" }, "help-anoma-ly": { text: "help@anoma.ly" } },
        },
        security: {
          title: "الأمان",
          body: "أبلغ عن الثغرات عبر GitHub. إن لم يردّ أحد خلال 6 أيام عمل، راسلنا.",
          links: {
            "report-a-vulnerability": { text: "أبلغ عن ثغرة" },
            "security-anoma-ly": { text: "security@anoma.ly" },
          },
        },
      },
    },
  },
  download: {
    desktop: { title: "Desktop" },
    mobile: { title: "Mobile", stores: { "google-play": { label: "Google Play" } } },
    terminal: { title: "Terminal", installs: { curl: { name: "سكربت" } } },
    extensions: {
      title: "الإضافات",
      items: {
        cursor: { label: "Cursor" },
        zed: { label: "Zed" },
        windsurf: { label: "Windsurf" },
        vscodium: { label: "VSCodium" },
      },
    },
  },
  productDownloads: {
    terminal: { commands: { curl: { name: "سكربت" } } },
    sdk: { more: { label: "اقرأ وثائق SDK" } },
    mini: {
      lead: "يأتي Mini مع OpenCode CLI. ثبّته بأي من هذه الطرق، ثم شغّل opencode mini.",
      commands: { curl: { name: "سكربت" } },
    },
  },
  pair: {
    title: "اربط هاتفك",
    cardTitle: "اربط هاتفك بأمر واحد",
    intro:
      "يتيح لك OpenCode Mobile التحكّم عن بُعد في OpenCode على حاسوبك. تواصل جلساتك العمل على الحاسوب، ويعرضها التطبيق على هاتفك لتتمكّن من توجيهها.",
    steps: {
      "get-the-app": {
        title: "احصل على التطبيق",
        body: "ثبّت نسخة OpenCode التجريبية على iPhone عبر TestFlight، أو ثبّت التطبيق على هاتف Android.",
      },
      "run-this-on-your-computer": {
        title: "شغّل هذا الأمر على حاسوبك",
        body: "يعرض الأمر رابطًا ورمز QR. كلاهما صالح للاستخدام مرة واحدة، وتنتهي صلاحيتهما بعد 5 دقائق.",
      },
      "scan-the-code": {
        title: "امسح الرمز",
        body: "امسح رمز QR بالتطبيق، أو الصق الرابط. تُفتح جلسات حاسوبك الأخيرة على هاتفك.",
      },
    },
    note: "يستخدم الخيار \u2066--remote\u2069 عنوان OpenTunnel للاتصال من أي شبكة. وعلى شبكة Wi-Fi نفسها، شغّل \u2066opencode service set hostname 0.0.0.0\u2069 مرة واحدة، ثم شغّل \u2066opencode pair\u2069.",
    facts: [
      "يمكنك الربط من أي شبكة لأن الخيار \u2066--remote\u2069 يتّصل عبر عنوان OpenTunnel.",
      "يعمل الرابط والرمز مرة واحدة وتنتهي صلاحيتهما خلال 5 دقائق.",
      "أبقِ الحاسوب قيد التشغيل، لأن الوكيل يعمل عليه لا على الهاتف.",
      "على شبكة Wi-Fi نفسها، شغّل \u2066opencode service set hostname 0.0.0.0\u2069 مرة واحدة، ثم شغّل \u2066opencode pair\u2069.",
    ],
  },
  announcements: {
    "create-install-and-share-desktop-plugins": {
      text: "أنشئ ملحقات Desktop وثبّتها وشاركها.",
      link: "اكتشف جديد 2.2",
    },
    "desktop-terminals-now-survive-restarts": {
      text: "تظلّ طرفيات Desktop متاحة بعد إعادة التشغيل.",
      link: "شاهد v2.2.4",
    },
    "agents-can-now-generate-images": { text: "يستطيع الوكلاء الآن توليد الصور.", link: "شاهد v2.2.1" },
    "steer-your-sessions-from-your-phone": { text: "وجّه جلساتك من هاتفك.", link: "تعرّف على OpenCode Mobile" },
    "a-refreshed-desktop-app": { text: "تطبيق سطح مكتب بحلّة جديدة.", link: "اكتشف جديد 2.2" },
  },
} satisfies ContentOverlay
