<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="لوگوی OpenCode">
    </picture>
  </a>
</p>
<p align="center">عامل کدنویسی متن‌باز مبتنی بر هوش مصنوعی.</p>
<p align="center">
  <a href="https://opencode.ai/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/opencode-ai"><img alt="npm" src="https://img.shields.io/npm/v/opencode-ai?style=flat-square" /></a>
  <a href="https://github.com/anomalyco/opencode/actions/workflows/publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/anomalyco/opencode/publish.yml?style=flat-square&branch=dev" /></a>
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
  <a href="README.vi.md">Tiếng Việt</a> |
  <a href="README.fa.md">فارسی</a>
</p>

[![OpenCode Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://opencode.ai)

---

### نصب

```bash
# YOLO
curl -fsSL https://opencode.ai/install | bash

# Package managers
npm i -g opencode-ai@latest        # or bun/pnpm/yarn
scoop install opencode             # Windows
choco install opencode             # Windows
brew install anomalyco/tap/opencode # macOS and Linux (recommended, always up to date)
brew install opencode              # macOS and Linux (official brew formula, updated less)
sudo pacman -S opencode            # Arch Linux (Stable)
paru -S opencode-bin               # Arch Linux (Latest from AUR)
mise use -g opencode               # Any OS
nix run nixpkgs#opencode           # or github:anomalyco/opencode for latest dev branch
```

> [!TIP]
> پیش از نصب، نسخه‌های قدیمی‌تر از `0.1.x` را حذف کنید.

### برنامه دسکتاپ (BETA)

OpenCode به‌صورت برنامه دسکتاپ هم در دسترس است. می‌توانید آن را مستقیماً از [صفحه انتشارها](https://github.com/anomalyco/opencode/releases) یا [opencode.ai/download](https://opencode.ai/download) دانلود کنید.

| پلتفرم                | فایل دانلود                         |
| --------------------- | ---------------------------------- |
| macOS (Apple Silicon) | `opencode-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `opencode-desktop-mac-x64.dmg`     |
| Windows               | `opencode-desktop-windows-x64.exe` |
| Linux                 | `.deb`, `.rpm`, یا `.AppImage`     |

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/opencode-desktop
```

#### مسیر نصب

اسکریپت نصب برای انتخاب مسیر نصب از اولویت‌های زیر استفاده می‌کند:

1. `$OPENCODE_INSTALL_DIR` - مسیر نصب سفارشی
2. `$XDG_BIN_DIR` - مسیر سازگار با مشخصات XDG Base Directory
3. `$HOME/bin` - پوشه استاندارد فایل‌های اجرایی کاربر، اگر وجود داشته باشد یا قابل ایجاد باشد
4. `$HOME/.opencode/bin` - مسیر پیش‌فرض جایگزین

```bash
# Examples
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### عامل‌ها

OpenCode دو عامل داخلی دارد که می‌توانید با کلید `Tab` بین آن‌ها جابه‌جا شوید.

- **build** - عامل پیش‌فرض با دسترسی کامل برای کارهای توسعه
- **plan** - عامل فقط‌خواندنی برای تحلیل و بررسی کد
  - به‌طور پیش‌فرض اجازه ویرایش فایل‌ها را نمی‌دهد
  - پیش از اجرای دستورهای bash اجازه می‌گیرد
  - برای بررسی کدبیس‌های ناآشنا یا برنامه‌ریزی تغییرات مناسب است

همچنین یک زیرعامل **general** برای جست‌وجوهای پیچیده و کارهای چندمرحله‌ای وجود دارد.
این زیرعامل به‌صورت داخلی استفاده می‌شود و با نوشتن `@general` در پیام‌ها قابل فراخوانی است.

اطلاعات بیشتر درباره [عامل‌ها](https://opencode.ai/docs/agents).

### مستندات

برای اطلاعات بیشتر درباره پیکربندی OpenCode، [**مستندات را ببینید**](https://opencode.ai/docs).

### مشارکت

اگر می‌خواهید در توسعه OpenCode مشارکت کنید، پیش از ارسال pull request لطفاً [راهنمای مشارکت](./CONTRIBUTING.md) را مطالعه کنید.

### ساخت پروژه بر پایه OpenCode

اگر روی پروژه‌ای مرتبط با OpenCode کار می‌کنید و در نام آن از "opencode" استفاده شده است، برای مثال "opencode-dashboard" یا "opencode-mobile"، لطفاً در README توضیح دهید که آن پروژه توسط تیم OpenCode ساخته نشده و هیچ وابستگی رسمی به OpenCode ندارد.

---

**به جامعه ما بپیوندید** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
