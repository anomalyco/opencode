<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logo">
    </picture>
  </a>
</p>
<p align="center">وكيل برمجة الذكاء الاصطناعي مفتوح المصدر.</p>
<p align="center">
  <a href="https://opencode.ai/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/opencode-ai"><img alt="npm" src="https://img.shields.io/npm/v/opencode-ai?style=flat-square" /></a>
  <a href="https://github.com/anomalyco/opencode/actions/workflows/publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/anomalyco/opencode/publish.yml?style=flat-square&branch=dev" /></a>
</p>

[![OpenCode Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://opencode.ai)

---

### التثبيت

```bash
# تثبيت سريع (YOLO)
curl -fsSL https://opencode.ai/install | bash

# مدراء الحزم
npm i -g opencode-ai@latest       # أو باستخدام bun/pnpm/yarn
scoop bucket add extras; scoop install extras/opencode  # لنظام Windows
choco install opencode            # لنظام Windows
brew install opencode             # لنظامي macOS و Linux
paru -S opencode-bin              # لنظام Arch Linux
mise use -g opencode              # لأي نظام تشغيل
nix run nixpkgs#opencode          # أو github:anomalyco/opencode للحصول على أحدث فرع تطوير
```

> [!TIP]
> ملاحظة: قم بإزالة الإصدارات الأقدم من 0.1.x قبل التثبيت.

### تطبيق سطح المكتب (تجريبي)

يتوفر OpenCode أيضًا كتطبيق لسطح المكتب. قم بالتنزيل مباشرة من [صفحة الإصدارات](https://github.com/anomalyco/opencode/releases) أو من [opencode.ai/download](https://opencode.ai/download).

| المنصة | التحميل |
| --------------------- | ------------------------------------- |
| macOS (Apple Silicon) | `opencode-desktop-darwin-aarch64.dmg` |
| macOS (Intel) | `opencode-desktop-darwin-x64.dmg` |
| Windows | `opencode-desktop-windows-x64.exe` |
| Linux | `.deb`، `.rpm`، أو AppImage |

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop
```

#### دليل التثبيت

يحترم سكريبت التثبيت ترتيب الأولوية التالي لمسار التثبيت:

1. `$OPENCODE_INSTALL_DIR` - دليل تثبيت مخصص
2. `$XDG_BIN_DIR` - مسار متوافق مع مواصفات الدليل الأساسي لـ XDG
3. `$HOME/bin` - دليل البيانات الثنائية للمستخدم القياسي (إذا كان موجودًا أو يمكن إنشاؤه)
4. `$HOME/.opencode/bin` - المسار الاحتياطي الافتراضي

```bash
# أمثلة
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### الوكلاء (Agents)

يتضمن OpenCode وكيلين مدمجين يمكنك التبديل بينهما باستخدام مفتاح `Tab`.

- **build** - الوكيل الافتراضي، ذو وصول كامل لأعمال التطوير
- **plan** - وكيل للقراءة فقط للتحليل واستكشاف الكود
  - يرفض تعديلات الملفات افتراضيًا
  - يطلب الإذن قبل تشغيل أوامر bash
  - مثالي لاستكشاف قواعد التعليمات البرمجية غير المألوفة أو تخطيط التغييرات

أيضًا، تم تضمين وكيل فرعي **general** لعمليات البحث المعقدة والمهام متعددة الخطوات.
يستخدم هذا داخليًا ويمكن استدعاؤه باستخدام `@general` في الرسائل.

تعرف على المزيد حول [الوكلاء](https://opencode.ai/docs/agents).

### الوثائق

لمزيد من المعلومات حول كيفية تكوين OpenCode [**توجه إلى وثائقنا**](https://opencode.ai/docs).

### المساهمة

إذا كنت مهتمًا بالمساهمة في OpenCode، يرجى قراءة [وثائق المساهمة](./CONTRIBUTING.md) قبل تقديم طلب سحب (Pull Request).

### البناء على OpenCode

إذا كنت تعمل على مشروع يتعلق بـ OpenCode ويستخدم "opencode" كجزء من اسمه؛ على سبيل المثال، "opencode-dashboard" أو "opencode-mobile"، يرجى إضافة ملاحظة إلى ملف README الخاص بك لتوضيح أنه لم يتم إنشاؤه بواسطة فريق OpenCode وليس له صلة بنا بأي شكل من الأشكال.

### الأسئلة الشائعة (FAQ)

#### كيف يختلف هذا عن Claude Code؟

إنه مشابه جدًا لـ Claude Code من حيث القدرة. إليك الفروق الرئيسية:

- مفتوح المصدر 100%
- غير مرتبط بأي مزود. على الرغم من أننا نوصي بالنماذج التي نقدمها من خلال [OpenCode Zen](https://opencode.ai/zen)؛ يمكن استخدام OpenCode مع Claude أو OpenAI أو Google أو حتى النماذج المحلية. مع تطور النماذج، ستنغلق الفجوات بينها وستنخفض الأسعار، لذا فإن كونها غير مرتبطة بمزود محدد أمر مهم.
- دعم LSP (بروتوكول خادم اللغة) جاهز للاستخدام
- التركيز على واجهة المستخدم النصية (TUI). تم بناء OpenCode بواسطة مستخدمي neovim ومبدعي [terminal.shop](https://terminal.shop)؛ سنقوم بدفع حدود ما هو ممكن في المحطة الطرفية (Terminal).
- هندسة العميل/الخادم. يسمح هذا على سبيل المثال لـ OpenCode بالعمل على جهاز الكمبيوتر الخاص بك، بينما يمكنك قيادته عن بعد من تطبيق جوال. مما يعني أن واجهة TUI الأمامية هي مجرد واحدة من العملاء المحتملين.

---

**انضم إلى مجتمعنا** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
