import type { ContentOverlay } from "./source"

export const content = {
  products: {
    desktop: {
      name: "Desktop",
      body: "جلسات وتبويبات وفروقات ومتصفح مدمج وإضافات على macOS وWindows وLinux.",
      action: "تنزيل",
    },
    mobile: { name: "Mobile", body: "ابدأ الجلسات ووجّهها ووافق عليها من هاتفك أينما كنت.", action: "تنزيل" },
    terminal: { name: "Terminal", body: "واجهة طرفية سريعة تعمل في أي صدفة أو محرر أو خادم بعيد.", action: "تثبيت" },
    sdk: { body: "تحكّم في OpenCode من سكربتاتك ومهام CI وأدواتك.", action: "الوثائق" },
    ide: {
      name: "إضافات IDE",
      body: "افتح OpenCode في VS Code وCursor وWindsurf، أو في Zed وبيئات JetBrains عبر ACP.",
      action: "تثبيت",
    },
    mini: { body: "واجهة طرفية بسيطة. تُطبع الردود في سجل التمرير، ويبقى سطر إدخال واحد في الأسفل.", action: "تثبيت" },
  },
  productDetails: {
    desktop: {
      title: "OpenCode | تطبيق سطح المكتب لأنظمة macOS وWindows وLinux",
      description:
        "شغّل عدة وكلاء OpenCode معًا، كلٌّ في علامة تبويب خاصة. راجع كل تغيير كفرق، وعلّق على أي سطر، وعاين النتيجة في المتصفح المدمج.",
      intro:
        "شغّل عدة وكلاء معًا، وكل جلسة في علامة تبويب خاصة. راجع كل تغيير كفرق، وعلّق على أي سطر، وتحقق من النتيجة في المتصفح المدمج. متاح لأنظمة macOS وWindows وLinux.",
      features: {
        "built-in-terminal": { title: "طرفية مدمجة", body: "شغّل الأوامر في علامة تبويب طرفية بجانب الجلسة." },
        "ssh-servers": { title: "خوادم SSH", body: "اتصل بجهاز آخر عبر SSH واعمل على مشاريعه." },
        extensions: { title: "الإضافات", body: "أدِر خوادم MCP والملحقات والمهارات من قائمة واحدة." },
        wsl: { title: "WSL", body: "على Windows، شغّل الجلسات في توزيعة WSL 2 بدل التشغيل الأصلي." },
        "office-files": { title: "ملفات Office", body: "افتح ملفات Word وExcel وPowerPoint بجانب الجلسة." },
        "keyboard-shortcuts": { title: "اختصارات المفاتيح", body: "لكل إجراء اختصار، ويمكنك تغيير أي منها." },
        "updates-itself": { title: "يحدّث نفسه", body: "تُنزَّل الإصدارات الجديدة وتُثبَّت من داخل التطبيق." },
        "all-your-projects": { title: "كل مشاريعك", body: "تنقّل بين المشاريع وجلساتها في نافذة واحدة." },
      },
      showcase: {
        "sessions-in-tabs": {
          title: "جلسات في تبويبات",
          body: "اترك عدة وكلاء يعملون معًا، وكل جلسة في علامة تبويب خاصة.",
        },
        "review-and-comment": { title: "راجع وعلّق", body: "اقرأ كل تغيير كفرق، وعلّق على سطر، وأعِده إلى الوكيل." },
        "see-it-in-the-browser": {
          title: "شاهده في المتصفح",
          body: "يُفتح عمل الوكيل في متصفح بجانب الجلسة فور وصوله.",
        },
        "pair-your-phone": { title: "اربط هاتفك", body: "امسح رمز QR في OpenCode Mobile لتوجّه الجلسات من iPhone." },
      },
    },
    mobile: {
      title: "OpenCode | Mobile، جلسات البرمجة على هاتفك",
      description:
        "ابدأ جلسات OpenCode ووجّهها ووافق عليها من هاتفك. تحدّث مع الوكيل، وراجع تغييراته، واسمح بما يحتاجه، بينما يعمل على حاسوبك.",
      intro:
        "ابدأ الجلسات ووجّهها ووافق عليها من هاتفك أينما كنت. اتصل بجلسة وتحدّث مع الوكيل، وراجع تغييراته، واسمح بما يحتاجه، وكل ذلك مع OpenCode الذي يعمل على حاسوبك الخاص.",
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
        voice: { title: "الصوت", body: "اتصل بجلسة وقل ما تحتاجه. يجيبك الوكيل بصوت مسموع." },
        approvals: { title: "الموافقات", body: "راجع التغيير واسمح به من هاتفك عندما يطلب الوكيل." },
        results: { title: "النتائج", body: "تخبرك المكالمة بما تغيّر بعد انتهاء العمل الذي طلبته." },
        sessions: { title: "الجلسات", body: "افتح أي جلسة لترى أين وصلت، ثم أكمل من حيث توقفت." },
        steer: { title: "التوجيه", body: "أرسل رسالة متابعة لتغيير الاتجاه في منتصف الجلسة." },
      },
    },
    terminal: {
      title: "OpenCode | واجهة طرفية لوكيل البرمجة مفتوح المصدر",
      description:
        "واجهة طرفية سريعة لـ OpenCode تعمل في أي صدفة أو محرر أو خادم بعيد. صِف ما تريد، وشاهد كل تعديل كفرق، ووافق على الأوامر.",
      intro:
        "واجهة طرفية سريعة تعمل في أي صدفة أو محرر أو خادم بعيد. صِف ما تريد بكلمات بسيطة، وشاهد كل تعديل يصل كفرق، واختر الأوامر التي تعمل تلقائيًا.",
      features: {
        "any-terminal": { title: "أي طرفية", body: "يعمل في أي صدفة، وفي طرفية محررك، وعلى خادم بعيد." },
        "diffs-in-the-timeline": {
          title: "فروقات في الخط الزمني",
          body: "شاهد كل تعديل كفرق في الخط الزمني لحظة إجرائه.",
        },
        "pick-up-later": { title: "أكمل لاحقًا", body: "أكمل آخر جلسة عبر -c، أو أي جلسة عبر -s." },
        "one-off-runs": { title: "تشغيل لمرة واحدة", body: "يرسل opencode run رسالة واحدة ويطبع الرد." },
        "agents-and-commands": {
          title: "وكلاء وأوامر",
          body: "بدّل الوكلاء عبر shift+tab وافتح كل الأوامر عبر ctrl+p.",
        },
        "auto-approve": { title: "موافقة تلقائية", body: "شغّل مع --auto للسماح بكل إجراء لم ترفضه." },
        "any-server": { title: "أي خادم", body: "اتصل بخادم OpenCode عبر عنوان URL مع --server." },
        "usage-stats": { title: "إحصاءات الاستخدام", body: "يعرض opencode stats إحصاءات استخدام قابلة للمشاركة." },
      },
      showcase: {
        "ask-in-plain-words": { title: "اطلب بكلمات بسيطة", body: "اكتب ما تريد، ويعرض الوكيل خطته أثناء العمل." },
        "approve-what-runs": { title: "وافق على ما يعمل", body: "تظهر التعديلات كفروقات، وتنتظر الأوامر إذنك." },
        "make-it-yours": { title: "اجعله لك", body: "بدّل السمات بضغطة مفتاح، من الافتراضية إلى tokyonight وغيرها." },
        mini: { title: "Mini", body: "شغّل opencode mini فتُطبع الردود في سجل التمرير الخاص بك." },
      },
    },
    sdk: {
      title: "OpenCode | TypeScript SDK للسكربتات ومهام CI والأدوات",
      description:
        "تحكّم في OpenCode من سكربتاتك ومهام CI وأدواتك. ينشئ عميل TypeScript المُنمّط الجلسات ويرسل المطالبات ويبث كل حدث لحظة وقوعه.",
      intro:
        "تحكّم في OpenCode من سكربتاتك ومهام CI وأدواتك. يشغّل SDK OpenCode داخل عمليتك، بإعداداتك ونماذجك، وينشئ عميله المُنمّط الجلسات ويرسل المطالبات ويبث كل حدث.",
      features: {
        "typescript-client": { title: "عميل TypeScript", body: "طلبات وأحداث مُنمّطة، بنفس قيم @opencode/client." },
        "sessions-from-code": { title: "جلسات من الكود", body: "أنشئ الجلسات وأرسل المطالبات من أي سكربت." },
        "any-model": { title: "أي نموذج", body: "يستخدم النماذج المضبوطة في إعداد OpenCode لديك." },
        "npm-or-bun": { title: "npm أو bun", body: "ثبّته عبر npm i @opencode/sdk أو bun add @opencode/sdk." },
        "in-process-host": { title: "مضيف داخل العملية", body: "يشغّل OpenCode في الذاكرة، دون المرور بالشبكة." },
        "your-plugins": { title: "ملحقاتك", body: "مرّر ملحقاتك عند إنشاء المضيف داخل العملية." },
        "promise-or-effect": { title: "Promise أو Effect", body: "واجهة Promise API وواجهة Effect API بنفس القيم." },
        "cloudflare-workers": {
          title: "Cloudflare Workers",
          body: "شغّل OpenCode داخل Cloudflare Durable Object على Workers.",
        },
      },
      showcase: {
        "fix-ci-from-code": {
          title: "أصلح CI من الكود",
          body: "سكربت قصير يطلب من OpenCode إصلاح الاختبارات الفاشلة، ثم يشغّلها من جديد.",
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
    ide: {
      title: "OpenCode | تكاملات المحررات لـ VS Code وCursor وZed",
      description:
        "استخدم OpenCode داخل محررك، مع الإضافة لـ VS Code وCursor وWindsurf وVSCodium، وopencode acp لـ Zed وبيئات JetBrains ومحررات ACP الأخرى.",
      intro:
        "استخدم OpenCode داخل محررك. في VS Code وCursor وWindsurf وVSCodium، شغّل opencode في الطرفية المدمجة فتثبّت الإضافة نفسها. أما Zed وبيئات JetBrains والمحررات الأخرى التي تدعم Agent Client Protocol فتشغّل OpenCode عبر opencode acp.",
      features: {
        "quick-launch": { title: "تشغيل سريع", body: "يفتح Cmd+Esc أو Ctrl+Esc OpenCode في طرفية مقسّمة." },
        "new-session": { title: "جلسة جديدة", body: "يبدأ Cmd+Shift+Esc أو Ctrl+Shift+Esc جلسة أخرى." },
        context: { title: "السياق", body: "يشارك تحديدك الحالي أو علامة التبويب مع OpenCode." },
        "file-references": { title: "مراجع الملفات", body: "يُدرج Cmd+Option+K أو Alt+Ctrl+K المرجع @File#L37-42." },
        "installs-itself": { title: "تثبّت نفسها", body: "شغّل opencode في الطرفية المدمجة لإضافتها." },
        "acp-editors": { title: "محررات ACP", body: "Zed وبيئات JetBrains وAvante.nvim وCodeCompanion.nvim." },
        "open-vsx": { title: "Open VSX", body: "متاحة أيضًا على Open VSX لـ Cursor وWindsurf وVSCodium." },
        "same-agent": { title: "نفس الوكيل", body: "OpenCode الذي تشغّله في الطرفية، بجانب كودك." },
      },
    },
    mini: {
      title: "OpenCode | Mini، واجهة طرفية بسيطة للوكيل",
      description:
        "يشغّل Mini OpenCode في واجهة طرفية بسيطة. تُطبع الردود في سجل التمرير الخاص بطرفيتك، ولا يبقى في الأسفل إلا سطر الإدخال وسطر الحالة.",
      intro:
        "واجهة طرفية بسيطة لـ OpenCode. شغّل opencode mini فتُطبع الردود مباشرة في سجل التمرير الخاص بطرفيتك، فتتصفحها وتبحث فيها وتنسخها كأي مخرجات أخرى. لا يبقى في الأسفل إلا سطر الإدخال وسطر الحالة.",
      features: {
        "your-scrollback": { title: "سجل التمرير", body: "تصبح الردود جزءًا عاديًا من سجل الطرفية." },
        "one-prompt": { title: "سطر واحد", body: "الوكيل والنموذج والسياق والتكلفة في سطر حالة واحد." },
        permissions: { title: "الأذونات", body: "اسمح بالتعديلات والأوامر من منطقة الإدخال." },
        "how-much-shows": { title: "مقدار العرض", body: "هادئ أو افتراضي أو كل شيء، للتفكير ومخرجات الأدوات." },
        "pick-up-later": { title: "أكمل لاحقًا", body: "أكمل آخر جلسة عبر -c، أو أي جلسة عبر -s." },
        "same-opencode": { title: "نفس OpenCode", body: "نفس الخادم والوكلاء والنماذج كالتطبيقات الأخرى." },
        agents: { title: "الوكلاء", body: "بدّل الوكلاء من سطر الإدخال مباشرة." },
        compact: { title: "الضغط", body: "قلّص جلسة طويلة عبر /compact." },
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
        "يتيح Browse لـ OpenCode وعملاء MCP الآخرين استخدام متصفحك الحقيقي. يقود الوكلاء علامات تبويب في الخلفية عبر Playwright ويعيدون إليك تسجيل الدخول و2FA.",
      intro:
        "خادم MCP وإضافة Chromium يتيحان لوكلائك استخدام متصفحك الحقيقي، بعلامات تبويبك وتسجيلات دخولك وإضافاتك. يفتحون علامات التبويب ويقودونها عبر Playwright، ويلتقطون الصور ويسجّلون الشاشة، في علامات تبويب خلفية مجمّعة بعيدًا عن طريقك. وعندما يحين دورك، لتسجيل دخول أو طلب 2FA أو دفع، يعيدون إليك علامة التبويب ويكملون بمجرد أن تنقر Continue.",
      features: {
        "your-real-browser": {
          title: "متصفحك الحقيقي",
          body: "Chrome وEdge وBrave وArc وHelium وVivaldi وOpera وChromium.",
        },
        "out-of-your-way": {
          title: "بعيدًا عن طريقك",
          body: "تُفتح علامات تبويب الوكلاء في الخلفية، في مجموعات مطوية.",
        },
        handoffs: { title: "التسليم", body: "نفّذ خطوة تسجيل الدخول أو 2FA بنفسك، ثم انقر Continue." },
        "lend-a-tab": { title: "أعِر علامة تبويب", body: "انقر زر شريط الأدوات لتسليم الوكيل علامة تبويب مفتوحة." },
        "record-and-capture": { title: "تسجيل والتقاط", body: "لقطات شاشة وتسجيلات شاشة وحركة الشبكة بصيغة HAR." },
        "any-mcp-client": { title: "أي عميل MCP", body: "OpenCode وClaude Code وCursor وCodex وZed وغيرها الكثير." },
        "named-sessions": { title: "جلسات مسمّاة", body: "تحتفظ كل جلسة بعلامات تبويبها حتى بعد إعادة التشغيل." },
        allowlists: { title: "قوائم السماح", body: "اقصر علامات تبويب الجلسة على المواقع التي تحددها." },
      },
      install:
        "شغّل هذا مرة واحدة. يضيف خادم browse MCP إلى الوكلاء الذين تختارهم ويربط الإضافة من Chrome Web Store. يتطلب Node.js 22.19 أو أحدث.",
    },
  },
  apps: {
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
      download: { title: "نزّل", line: "Desktop أو Mobile أو Terminal." },
      "use-free-models": {
        title: "نماذج مجانية",
        line: "يأتي OpenCode مع مجموعة من النماذج المجانية. لا حاجة إلى حساب.",
      },
      "add-more-models": {
        title: "نماذج أكثر",
        line: "استخدم اشتراكك الخاص، أو نماذج OpenCode Go المختارة بدءًا من 10$ شهريًا.",
      },
    },
    sentence: "نزّل OpenCode، وابدأ بالنماذج المجانية، واستخدم اشتراكك الخاص أو OpenCode Go عندما تريد المزيد.",
  },
  byos: {
    title: "اشتراكك الخاص",
    headline: "استخدم الاشتراكات التي لديك بالفعل.",
    line: "سجّل الدخول عبر ChatGPT Plus أو Pro، أو GitHub Copilot، أو Claude Code. أو استخدم اشتراك OpenCode.",
    yours: { label: "اشتراكك", items: { "chatgpt-plus-pro": { name: "ChatGPT Plus/Pro" } } },
    planLinks: ["اشتراك OpenCode", "OpenCode Go"],
    ours: { label: "خطط OpenCode" },
  },
  brand: {
    hero: { copy: { text: "قواعد للوكيل", copied: "نُسخت القواعد" } },
    naming: {
      title: "التسمية",
      body: "اكتب OpenCode كلمة واحدة، بحرف O كبير وحرف C كبير. لا تكتب Opencode أو Open Code أو OpenCode AI أو Open-Code.",
      code: "استخدم `opencode` بالأحرف الصغيرة فقط في الكود وأسماء الحزم، مثل `opencode-figma` أو `@acme/opencode-plugin`.",
    },
    families: {
      logo: {
        title: "الشعار",
        body: "الشعار وحده، لأيقونات التطبيقات والصور الرمزية والمساحات الصغيرة الأخرى. تضيف النسخ المربعة حشوة للأماكن التي تقص الصورة إلى مربع.",
        assets: {
          light: { name: "فاتح" },
          dark: { name: "داكن" },
          "square-light": { name: "مربع، فاتح" },
          "square-dark": { name: "مربع، داكن" },
        },
      },
      wordmark: {
        title: "الشعار النصي",
        body: "الاسم الكامل بحروف OpenCode. استخدمه حيثما توفرت مساحة لكتابة الاسم كاملًا.",
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
      body: "صور رمزية مربعة بحجم 1024px لحسابات Slack وDiscord وGitHub وغيرها. تملأ الخلفية المربع كله ويقع الشعار داخل الدائرة بمسافة كافية، فتصمد أمام القص الدائري.",
      items: { dark: { name: "داكن" }, light: { name: "فاتح" } },
    },
    colors: {
      title: "الألوان",
      body: "يستخدم الشعار والشعار النصي حبرًا واحدًا بثلاث درجات من العتامة، مع حبر أفتح للخلفيات الداكنة. القيم أدناه هي ذلك الحبر فوق الأبيض أو #0B0B0B، كما تعرضه الملفات القياسية. انقر قيمة لنسخها.",
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
          body: "الشعار المناسب لكل مكان تقريبًا. ظله الداخلي شفاف، فيبدو على الأبيض أو الأسود تمامًا مثل الرماديين ثنائيي اللون، وتظهر الخلفية من خلاله على الصور والتدرجات والألوان.",
          rows: {
            logo: { title: "الشعار", tiles: { dark: { name: "داكن" }, light: { name: "فاتح" } } },
            wordmark: { title: "الشعار النصي", tiles: { dark: { name: "داكن" }, light: { name: "فاتح" } } },
          },
        },
        simple: {
          name: "البسيطة",
          body: "لون واحد، بفراغات حروف مفتوحة ودون ظل داخلي. استخدمها على الخلفيات الملونة المسطحة، وللطباعة بلون واحد، وحيثما لا يمكنك استخدام الرماديات. البسيطة الداكنة على الألوان الفاتحة، والبسيطة الفاتحة على الألوان الداكنة.",
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
        body: "نسب الشعار ثابتة عند 4:5، والخط الواحد ربع عرضه. غيّر حجمه بخطوات من 4 × 5px، حتى تقع كل حافة وكل خط على بكسل كامل.",
        do: "إبقاء كل حافة والخط بعرض 4px على بكسلات كاملة.",
        dont: "تغيّر حجم الشعار خارج نسبة 4:5، وإلا وقعت حوافه بين البكسلات وصارت ضبابية.",
        sizes: { logo: { title: "الشعار" }, wordmark: { title: "الشعار النصي" } },
      },
      minimumTitle: "أصغر الأحجام",
      minimum: {
        logo: { title: "الشعار", body: "لا يقل عن 16 × 20px، بخط 4px. أي حجم أصغر يجعله ضبابيًا." },
        wordmark: { title: "الشعار النصي", body: "لا يقل عن 117 × 21px، بخط 3px. أي حجم أصغر يجعله ضبابيًا." },
      },
    },
    donts: {
      title: "تجنّب",
      body: "أخطاء شائعة تجنّبها عند استخدام الشعار والشعار النصي.",
      examples: {
        "two-tone": { caption: "تُعِد تلوين الشعار بألوان جديدة." },
        bright: { caption: "تستخدم لونًا ساطعًا واحدًا." },
        gradient: { caption: "تملأ الشعار بتدرج لوني." },
        inverted: { caption: "تبدّل الدرجات." },
        stretch: { caption: "تمطّ الشعار أو تضغطه." },
        shadow: { caption: "تُضِف ظلالًا." },
        glow: { caption: "تُضِف توهجًا أو حدودًا." },
        lockup: { caption: "تضع كلمات أخرى بجانب الشعار." },
        "low-contrast": { caption: "تستخدم رماديًا منخفض التباين على رمادي." },
        color: { caption: "تضع الشعار الرمادي ثنائي اللون على خلفية ملونة، حيث تصبح رمادياته باهتة." },
      },
    },
    integrations: {
      title: "التكاملات",
      body: "يمكن للملحقات والمزوّدين والأدوات التي تعمل مع OpenCode، والمشاريع المبنية به، أن تذكر ذلك. استخدم شارة أو شعارًا مشتركًا، وسمِّ مشروعك بحيث يتضح أنه لك.",
      badges: {
        body: "ضع شارة في ملف README أو الوثائق أو موقعك واربطها بـ opencode.ai. اختر الملف الفاتح أو الداكن حسب خلفيتك (تتبدّل نسخة HTML تلقائيًا)، ولا تغيّر الألوان أو النص.",
        sizes: "يتوفر كل نمط بأحجام 20 و32 و44px (Shields بحجم 20px فقط)، بصيغة SVG وبصيغة PNG بدقة 2×.",
        mono: "لكل ملف أيضًا نسخة بخط OpenTUI Mono. أضف -mono قبل الامتداد، كما في opencode-works-with-a-light-20-mono.svg، أو -mono-caps لخط OpenTUI Mono بالأحرف الكبيرة.",
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
    title: "OpenCode | الملف الصحفي مع حقائق الشركة وأصول العلامة",
    description:
      "الملف الصحفي لـ OpenCode، مع حقائق عن OpenCode وعن Anomaly، الشركة التي تقف وراءه، إضافة إلى شعارات للتنزيل وجهة اتصال لأسئلة الصحافة.",
    hero: { title: "الصحافة", body: "حقائق وأصول العلامة وجهات اتصال للكتابة عن OpenCode وAnomaly." },
    company: {
      title: "عن Anomaly",
      lead: "Anomaly هي الشركة التي تقف وراء OpenCode. تبني أدوات مفتوحة المصدر للمطورين.",
      more: "من مشاريعها الأخرى SST وOpenTUI، وكلها مفتوحة المصدر على [GitHub](github).",
      learnMore: "لمعرفة المزيد، زُر [anoma.ly](site).",
      projects: {
        opencode: {
          body: "وكيل البرمجة مفتوح المصدر، مع تطبيقات لسطح المكتب والهاتف والطرفية، وSDK. مرخّص بـ MIT، وأكثر من 220,000 نجمة على GitHub.",
        },
        sst: {
          body: "إطار عمل لبناء تطبيقات متكاملة على بنيتك التحتية الخاصة. مرخّص بـ MIT، ومفتوح منذ 2020، وأكثر من 26,000 نجمة على GitHub.",
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
          body: "CLI وSDK يمنحان التطبيقات على جهازك عنوان HTTPS عامًا. ينتهي TLS على جهازك، فلا يرى الوسيط النص الصريح أبدًا.",
        },
      },
    },
    about: {
      title: "عن OpenCode",
      boilerplate: {
        long: "OpenCode وكيل برمجة مفتوح المصدر. يتوفر كتطبيق لسطح المكتب وتطبيق للهاتف وواجهة طرفية وSDK، ويعمل مع نماذج من أي مزوّد، منها Claude وGPT وGemini. OpenCode مرخّص بـ MIT ومن صنع Anomaly. لديه أكثر من 220,000 نجمة على GitHub وأكثر من 1,000 مساهم، ويستخدمه أكثر من 22 مليون مطوّر كل شهر.",
        short: "OpenCode وكيل برمجة مفتوح المصدر من Anomaly، مع تطبيقات لسطح المكتب والهاتف والطرفية، وSDK.",
      },
      products: {
        "opencode-console": {
          name: "OpenCode Console",
          long: "OpenCode Console هو تطبيق الويب الذي يشتري فيه المطورون والفرق الوصول إلى نماذج AI ويديرونه لـ OpenCode ووكلاء البرمجة الآخرين. يقدّم استدلالًا بالدفع حسب الاستخدام للنماذج المتقدمة ومفتوحة الأوزان، يُحتسب لكل طلب من رصيد مدفوع مسبقًا، إضافة إلى اشتراكات OpenCode Go. تحصل الفرق على مساحات عمل بأدوار Member وAdmin وOwner، وحدود إنفاق لمساحة العمل ولكل مستخدم، وتسجيل دخول موحّد عبر Okta أو Microsoft Entra ID أو Google Workspace، وSCIM. يدعم Console أكثر من 30 مزوّدًا، فتستطيع الفرق ربط حسابات المزوّدين التي لديها، والاستدلال الخاص به اختياري. عنوانه opencode.ai/console.",
          short:
            "OpenCode Console هو تطبيق الويب من Anomaly للوصول إلى نماذج AI بالدفع حسب الاستخدام، واشتراكات OpenCode Go، وضوابط الفرق مثل الميزانيات وتسجيل الدخول الموحّد.",
        },
        "opencode-go": {
          long: "OpenCode Go اشتراك للمطورين الذين يريدون سعرًا شهريًا ثابتًا لنماذج البرمجة. تكلّف Go 10$ شهريًا، وGo Plus 40$ شهريًا بحدود أعلى، وGo Teams 20$ شهريًا لكل عضو. تتضمن كل خطة مجموعة مختارة من النماذج المختبرة للبرمجة بالوكلاء. حدود الاستخدام مبالغ شهرية بالدولار لكل نموذج، مع حصص متجددة كل 5 ساعات وأسبوعيًا تبلغ 20% و50% من الحد الشهري. يمكن للمشتركين شحن الرصيد، والرجوع إلى رصيد الدفع حسب الاستخدام، والإلغاء في أي وقت. يعمل Go مع OpenCode ووكلاء آخرين. عنوانه opencode.ai/console/go.",
          short:
            "OpenCode Go اشتراك شهري من Anomaly يمنح المطورين حدود استخدام شهرية على مجموعة مختارة من نماذج البرمجة، بدءًا من 10$ شهريًا.",
        },
        "opencode-data": {
          name: "OpenCode Data",
          long: "OpenCode Data لوحة معلومات عامة تعرض نماذج AI التي يستخدمها المطورون في OpenCode وكيف يتغير هذا المزيج بمرور الوقت. تنشر ترتيبًا لأفضل النماذج، واستهلاك الرموز، وتكاليف الجلسات والرموز، ونسب التخزين المؤقت، والحصة السوقية، وتوزيعًا حسب الدولة. تُجمَّع الأرقام كل ساعة، والأيام والأسابيع بتوقيت UTC. أعداد المستخدمين والجلسات تقريبية، والتكاليف مبنية على أسعار القائمة من كتالوج نماذج OpenCode. يمكن للصحفيين الاستشهاد بها باسم OpenCode Data (opencode.ai/data) مع وقت التحديث المعروض في الصفحة.",
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
        "1-million-downloads": { date: "أكتوبر 2025", text: "أكثر من مليون تنزيل" },
        "opencode-1-0": { date: "أكتوبر 2025", text: "OpenCode 1.0" },
        "desktop-app-ships": { date: "ديسمبر 2025", text: "إطلاق تطبيق Desktop" },
        "10-million-downloads": { date: "يناير 2026", text: "أكثر من 10 ملايين تنزيل" },
        "opencode-2-0": { date: "سبتمبر 2026", text: "OpenCode 2.0" },
        "220-000-github-stars": { date: "نوفمبر 2026", text: "220,000+ نجمة على GitHub" },
      },
    },
    news: {
      title: "أحدث الإصدارات",
      intro: "يصدر OpenCode كثيرًا. هذه أحدث الإصدارات ذات الميزات الجديدة.",
      changelog: { text: "كل التغييرات" },
      feed: { text: "موجز RSS" },
    },
    media: {
      title: "الوسائط",
      intro: "صور ثابتة ومقاطع قصيرة لكل تطبيق، مسجّلة من المنتج الحقيقي. يمكنك استخدامها للكتابة عن OpenCode.",
      note: "كل اللقطات بالسمة الداكنة. الصور الثابتة والملصقات بصيغة JPG حتى 1920 × 1080، أو 1080 × 1350 بالوضع العمودي. المقاطع بصيغة MP4 دون صوت.",
      products: {
        desktop: {
          name: "Desktop",
          items: {
            "locked-landscape": { title: "فيديو Desktop" },
            "frame-1": { title: "صورة Desktop 1" },
            "frame-2": { title: "صورة Desktop 2" },
            "frame-3": { title: "صورة Desktop 3" },
            "frame-4": { title: "صورة Desktop 4" },
            "feature-1": { title: "جلسات في تبويبات" },
            "feature-2": { title: "راجع وعلّق" },
            "feature-3": { title: "شاهده في المتصفح" },
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
            "feature-2": { title: "الموافقات" },
            "feature-3": { title: "الجلسات" },
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
            "feature-2": { title: "وافق على ما يعمل" },
            "feature-3": { title: "اجعله لك" },
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
          body: "شغّل عدة وكلاء معًا، كلٌّ في علامة تبويب خاصة، على macOS وWindows وLinux. راجع كل تغيير كفرق وعاينه.",
        },
        mobile: {
          name: "Mobile",
          body: "أحدث تطبيقات OpenCode. اتصل بجلسة لتتحدث مع الوكيل، ثم راجع تغييراته ووافق عليها من هاتفك، أينما كنت.",
        },
        terminal: {
          name: "Terminal",
          body: "واجهة طرفية تعمل في أي صدفة أو محرر أو خادم بعيد. شاهد كل تعديل كفرق واختر الأوامر التي تعمل تلقائيًا.",
        },
        sdk: {
          body: "عميل TypeScript مُنمّط للسكربتات ومهام CI وأدواتك. أنشئ الجلسات وأرسل المطالبات وابثّ كل حدث لحظة وصوله.",
        },
      },
    },
    contact: {
      title: "التواصل",
      items: {
        press: { title: "الصحافة", body: "للصحفيين والمحللين. نردّ على طلبات وسائل الإعلام فقط." },
        support: {
          title: "الدعم",
          body: "للمساعدة في OpenCode، افتح issue أو اسأل المجتمع. لأسئلة الحساب والفوترة، راسلنا.",
          links: { "github-issues": { text: "مشكلات GitHub" }, "help-anoma-ly": { text: "help@anoma.ly" } },
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
    integrations: {
      title: "التكاملات",
      items: {
        github: { body: "استخدم OpenCode في GitHub Actions." },
        gitlab: { label: "GitLab", body: "استخدم OpenCode في GitLab CI/CD أو Duo." },
      },
    },
  },
  productDownloads: {
    terminal: { commands: { curl: { name: "سكربت" } } },
    sdk: { more: { label: "اقرأ وثائق SDK" } },
    ide: {
      lead: "شغّل opencode في الطرفية المدمجة في محررك فتثبّت الإضافة نفسها، أو ثبّتها بنفسك.",
      links: {
        "vs-code-marketplace": { label: "VS Code Marketplace" },
        "open-vsx-cursor-windsurf-vscodium": { label: "Open VSX (Cursor, Windsurf, VSCodium)" },
      },
      more: { label: "إعداد Zed وبيئات JetBrains ومحررات ACP الأخرى" },
    },
    mini: {
      lead: "يأتي Mini مع OpenCode CLI. ثبّته بأي من هذه الطرق، ثم شغّل opencode mini.",
      commands: { curl: { name: "سكربت" } },
    },
  },
  pair: {
    title: "اربط هاتفك",
    cardTitle: "اربط هاتفك بأمر واحد",
    intro:
      "OpenCode Mobile جهاز تحكم عن بُعد لـ OpenCode على حاسوبك. تظل جلساتك تعمل هناك، ويعرضها التطبيق ويتيح لك توجيهها.",
    steps: {
      "get-the-app": {
        title: "احصل على التطبيق",
        body: "ثبّت النسخة التجريبية من OpenCode على iPhone عبر TestFlight. تطبيق Android قادم قريبًا.",
      },
      "run-this-on-your-computer": {
        title: "شغّل هذا على حاسوبك",
        body: "يطبع رابطًا لمرة واحدة ورمز QR. يعملان مرة واحدة وتنتهي صلاحيتهما خلال 5 دقائق.",
      },
      "scan-the-code": {
        title: "امسح الرمز",
        body: "امسح رمز QR بالتطبيق، أو الصق الرابط. تُفتح جلسات حاسوبك الأخيرة على هاتفك.",
      },
    },
    note: "يتصل --remote عبر عنوان OpenTunnel، فيعمل من أي شبكة. على شبكة Wi-Fi نفسها، شغّل opencode service set hostname 0.0.0.0 مرة واحدة، ثم opencode pair.",
    facts: [
      "يعمل الربط من أي شبكة، لأن --remote يتصل عبر عنوان OpenTunnel.",
      "يعمل الرابط والرمز مرة واحدة وتنتهي صلاحيتهما خلال 5 دقائق.",
      "أبقِ الحاسوب قيد التشغيل، لأن الوكيل يعمل عليه لا على الهاتف.",
      "على شبكة Wi-Fi نفسها، شغّل opencode service set hostname 0.0.0.0 مرة واحدة، ثم opencode pair.",
    ],
  },
  announcements: {
    "create-install-and-share-desktop-plugins": {
      text: "أنشئ ملحقات Desktop وثبّتها وشاركها.",
      link: "اكتشف جديد 2.2",
    },
    "use-your-claude-code-login-in-opencode": {
      text: "سجّل الدخول إلى OpenCode بحساب Claude Code.",
      link: "شاهد v2.2.3",
    },
    "desktop-terminals-now-survive-restarts": {
      text: "طرفيات Desktop تبقى الآن بعد إعادة التشغيل.",
      link: "شاهد v2.2.4",
    },
    "agents-can-now-generate-images": { text: "يستطيع الوكلاء الآن توليد الصور.", link: "شاهد v2.2.1" },
    "steer-your-sessions-from-your-phone": { text: "وجّه جلساتك من هاتفك.", link: "تعرّف على OpenCode Mobile" },
    "a-refreshed-desktop-app": { text: "تطبيق سطح مكتب بحلّة جديدة.", link: "اكتشف جديد 2.2" },
  },
} satisfies ContentOverlay
