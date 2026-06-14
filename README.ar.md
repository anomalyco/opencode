<p align="center">
  <a href="https://daemonprotocol.com">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="شعار Daemon Protocol">
    </picture>
  </a>
</p>
<p align="center">وكيل برمجة بالذكاء الاصطناعي مفتوح المصدر.</p>
<p align="center">
  <a href="https://daemonprotocol.com/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/daemoncode"><img alt="npm" src="https://img.shields.io/npm/v/daemoncode?style=flat-square" /></a>
  <a href="https://github.com/daemon-blockint-tech/daemoncode/actions/workflows/publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/daemon-blockint-tech/daemoncode/publish.yml?style=flat-square&branch=dev" /></a>
</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh.md">简体中文</a> |
  <a href="README.zht.md">繁體中文</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.fr.md">Français</a> |
  <a href="README.it.md">Italiano</a> |
  <a href="README.da.md">Dansk</a> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.pl.md">Polski</a> |
  <a href="README.ru.md">Русский</a> |
  <a href="README.bs.md">Bosanski</a> |
  <a href="README.ar.md">العربية</a> |
  <a href="README.no.md">Norsk</a> |
  <a href="README.br.md">Português (Brasil)</a> |
  <a href="README.th.md">ไทย</a> |
  <a href="README.tr.md">Türkçe</a> |
  <a href="README.uk.md">Українська</a> |
  <a href="README.bn.md">বাংলা</a> |
  <a href="README.gr.md">Ελληνικά</a> |
  <a href="README.vi.md">Tiếng Việt</a>
</p>

[![Daemon Protocol Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://daemonprotocol.com)

---

### التثبيت

```bash
# YOLO
curl -fsSL https://daemonprotocol.com/install | bash

# مديري الحزم
npm i -g daemoncode@latest        # او bun/pnpm/yarn
scoop install daemoncode             # Windows
choco install daemoncode             # Windows
brew install daemon-blockint-tech/tap/daemoncode # macOS و Linux (موصى به، دائما محدث)
brew install daemoncode              # macOS و Linux (صيغة brew الرسمية، تحديث اقل)
sudo pacman -S daemoncode            # Arch Linux (Stable)
paru -S daemoncode-bin               # Arch Linux (Latest from AUR)
mise use -g daemoncode               # اي نظام
nix run nixpkgs#daemoncode           # او github:daemon-blockint-tech/daemoncode لاحدث فرع dev
```

> [!TIP]
> احذف الاصدارات الاقدم من 0.1.x قبل التثبيت.

### تطبيق سطح المكتب (BETA)

يتوفر Daemon Protocol ايضا كتطبيق سطح مكتب. قم بالتنزيل مباشرة من [صفحة الاصدارات](https://github.com/daemon-blockint-tech/daemoncode/releases) او من [daemonprotocol.com/download](https://daemonprotocol.com/download).

| المنصة                | التنزيل                            |
| --------------------- | ---------------------------------- |
| macOS (Apple Silicon) | `daemoncode-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `daemoncode-desktop-mac-x64.dmg`     |
| Windows               | `daemoncode-desktop-windows-x64.exe` |
| Linux                 | `.deb` او `.rpm` او AppImage       |

```bash
# macOS (Homebrew)
brew install --cask daemoncode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/daemoncode-desktop
```

#### مجلد التثبيت

يحترم سكربت التثبيت ترتيب الاولوية التالي لمسار التثبيت:

1. `$OPENCODE_INSTALL_DIR` - مجلد تثبيت مخصص
2. `$XDG_BIN_DIR` - مسار متوافق مع مواصفات XDG Base Directory
3. `$HOME/bin` - مجلد الثنائيات القياسي للمستخدم (ان وجد او امكن انشاؤه)
4. `$HOME/.opencode/bin` - المسار الافتراضي الاحتياطي

```bash
# امثلة
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://daemonprotocol.com/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://daemonprotocol.com/install | bash
```

### Agents

يتضمن Daemon Protocol وكيليْن (Agents) مدمجين يمكنك التبديل بينهما باستخدام زر `Tab`.

- **build** - الافتراضي، وكيل بصلاحيات كاملة لاعمال التطوير
- **plan** - وكيل للقراءة فقط للتحليل واستكشاف الكود
  - يرفض تعديل الملفات افتراضيا
  - يطلب الاذن قبل تشغيل اوامر bash
  - مثالي لاستكشاف قواعد كود غير مألوفة او لتخطيط التغييرات

بالاضافة الى ذلك يوجد وكيل فرعي **general** للبحث المعقد والمهام متعددة الخطوات.
يستخدم داخليا ويمكن استدعاؤه بكتابة `@general` في الرسائل.

تعرف على المزيد حول [agents](https://daemonprotocol.com/docs/agents).

### التوثيق

لمزيد من المعلومات حول كيفية ضبط Daemon Protocol، [**راجع التوثيق**](https://daemonprotocol.com/docs).

### المساهمة

اذا كنت مهتما بالمساهمة في Daemon Protocol، يرجى قراءة [contributing docs](./CONTRIBUTING.md) قبل ارسال pull request.

### البناء فوق Daemon Protocol

اذا كنت تعمل على مشروع مرتبط بـ Daemon Protocol ويستخدم "opencode" كجزء من اسمه (مثل "opencode-dashboard" او "opencode-mobile")، يرجى اضافة ملاحظة في README توضح انه ليس مبنيا بواسطة فريق Daemon Protocol ولا يرتبط بنا بأي شكل.

---

**انضم الى مجتمعنا** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
