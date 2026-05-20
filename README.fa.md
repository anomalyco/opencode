<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="لوگوی OpenCode">
    </picture>
  </a>
</p>
<p align="center">عامل هوش مصنوعی متن‌باز برای برنامه‌نویسی.</p>
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

### روش نصب کردن

```bash
# نصب سریع
curl -fsSL https://opencode.ai/install | bash

# با مدیر بسته (Package managers)
npm i -g opencode-ai@latest        # یا bun/pnpm/yarn
scoop install opencode             # ویندوز
choco install opencode             # ویندوز
brew install anomalyco/tap/opencode # macOS و لینوکس (توصیه‌شده)
brew install opencode              # macOS و لینوکس (فرمول رسمی)
sudo pacman -S opencode            # Arch Linux
paru -S opencode-bin               # Arch Linux (AUR - جدیدترین نسخه)
mise use -g opencode               # همه سیستم‌عامل‌ها
nix run nixpkgs#opencode           # یا github:anomalyco/opencode
```

> [!TIP]
> قبل از نصب، نسخه‌های قدیمی‌تر از 0.1.x را حذف کنید.

### برنامه دسکتاپ (BETA)

OpenCode همچنین به عنوان یک برنامه دسکتاپ در دسترس است. مستقیماً از [صفحه انتشارات](https://github.com/anomalyco/opencode/releases) یا [opencode.ai/download](https://opencode.ai/download) دانلود کنید.

| پلتفرم                | دانلود                            |
| --------------------- | ---------------------------------- |
| macOS (Apple Silicon) | `opencode-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `opencode-desktop-mac-x64.dmg`     |
| Windows               | `opencode-desktop-windows-x64.exe` |
| Linux                 | `.deb` یا `.rpm` یا AppImage       |

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/opencode-desktop
```

#### پوشه نصب

اسکریپت نصب ترتیب اولویت زیر را برای مسیر نصب رعایت می‌کند:

1. `$OPENCODE_INSTALL_DIR` - پوشه نصب سفارشی
2. `$XDG_BIN_DIR` - مسار مطابق با مشخصات XDG Base Directory
3. `$HOME/bin` - پوشه باینری استاندارد کاربر (اگر وجود داشته باشد یا بتوان ایجاد کرد)
4. `$HOME/.opencode/bin` - مسیر پیش‌فرض جایگزین

```bash
# مثال‌ها
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### عوامل

OpenCode شامل دو عامل داخلی است که می‌توانید با کلید `Tab` بین آن‌ها جابجا شوید.

- **build** - پیش‌فرض، عامل با دسترسی کامل برای کارهای توسعه
- **plan** - عامل فقط خواندنی برای تحلیل و کاوش کد
  - به‌طور پیش‌فرض ویرایش فایل‌ها را رد می‌کند
  - قبل از اجرای دستورات bash اجازه می‌خواهد
  - ایده‌آل برای کاوش پایگاه‌های کد ناآشنا یا برنامه‌ریزی تغییرات

علاوه بر این، یک عامل فرعی **general** برای جستجوهای پیچیده و کارهای چندمرحله‌ای وجود دارد.
این به‌طور داخلی استفاده می‌شود و می‌توان با `@general` در پیام‌ها آن را فراخوانی کرد.

بیشتر درباره [عوامل](https://opencode.ai/docs/agents) بدانید.

### مستندات

برای اطلاعات بیشتر درباره نحوه پیکربندی OpenCode، [**به مستندات ما مراجعه کنید**](https://opencode.ai/docs).

### مشارکت

اگر علاقه‌مند به مشارکت در OpenCode هستید، لطفاً قبل از ارسال pull request، [مستندات مشارکت](./CONTRIBUTING.md) ما را بخوانید.

### ساخت بر روی OpenCode

اگر روی پروژه‌ای کار می‌کنید که به OpenCode مرتبط است و از "opencode" به عنوان بخشی از نام آن استفاده می‌کند (مثلاً "opencode-dashboard" یا "opencode-mobile")، لطفاً در README خود یادداشتی اضافه کنید تا مشخص شود که توسط تیم OpenCode ساخته نشده و به هیچ وجه با ما مرتبط نیست.

---

**به جامعه ما بپیوندید** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)