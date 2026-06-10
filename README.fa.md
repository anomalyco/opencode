<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="لوگوی OpenCode">
    </picture>
  </a>
</p>
<p align="center">دستیار کدنویسی هوش مصنوعی متن‌باز.</p>
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

# مدیران بسته
npm i -g opencode-ai@latest        # یا bun/pnpm/yarn
scoop install opencode             # Windows
choco install opencode             # Windows
brew install anomalyco/tap/opencode # macOS و Linux (توصیه‌شده، همیشه به‌روز)
brew install opencode              # macOS و Linux (فرمول رسمی brew، به‌روزرسانی کمتر)
sudo pacman -S opencode            # Arch Linux (Stable)
paru -S opencode-bin               # Arch Linux (Latest from AUR)
mise use -g opencode               # هر سیستم‌عاملی
nix run nixpkgs#opencode           # یا github:anomalyco/opencode برای آخرین شاخه dev
```

> [!TIP]
> پیش از نصب، نسخه‌های قدیمی‌تر از 0.1.x را حذف کنید.

### نسخه دسکتاپ (BETA)

OpenCode به‌صورت یک برنامه دسکتاپ نیز در دسترس است. مستقیماً از [صفحه انتشارها](https://github.com/anomalyco/opencode/releases) یا [opencode.ai/download](https://opencode.ai/download) دانلود کنید.

| پلتفرم                | دانلود                             |
| --------------------- | ---------------------------------- |
| macOS (Apple Silicon) | `opencode-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `opencode-desktop-mac-x64.dmg`     |
| Windows               | `opencode-desktop-windows-x64.exe` |
| Linux                 | `.deb`، `.rpm` یا `.AppImage`      |

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/opencode-desktop
```

#### مسیر نصب

اسکریپت نصب، ترتیب اولویت زیر را برای مسیر نصب رعایت می‌کند:

1. `$OPENCODE_INSTALL_DIR` - مسیر نصب سفارشی
2. `$XDG_BIN_DIR` - مسیر سازگار با مشخصات XDG Base Directory
3. `$HOME/bin` - مسیر استاندارد فایل‌های اجرایی کاربر (اگر وجود داشته باشد یا قابل ایجاد باشد)
4. `$HOME/.opencode/bin` - مسیر پیش‌فرض جایگزین

```bash
# مثال‌ها
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### Agents

OpenCode شامل دو عامل (Agent) داخلی است که می‌توانید با کلید `Tab` بین آن‌ها جابه‌جا شوید.

- **build** - عامل پیش‌فرض با دسترسی کامل برای کارهای توسعه
- **plan** - عامل فقط‌خواندنی برای تحلیل و کاوش کد
  - به‌طور پیش‌فرض ویرایش فایل‌ها را رد می‌کند
  - پیش از اجرای دستورات bash اجازه می‌گیرد
  - مناسب برای کاوش پایگاه‌های کد ناآشنا یا برنامه‌ریزی تغییرات

همچنین یک زیرعامل **general** برای جست‌وجوهای پیچیده و کارهای چندمرحله‌ای وجود دارد.
این عامل به‌صورت داخلی استفاده می‌شود و می‌توان آن را با نوشتن `@general` در پیام‌ها فراخوانی کرد.

درباره [agents](https://opencode.ai/docs/agents) بیشتر بدانید.

### مستندات

برای اطلاعات بیشتر درباره نحوه پیکربندی OpenCode، [**به مستندات ما مراجعه کنید**](https://opencode.ai/docs).

### مشارکت

اگر به مشارکت در OpenCode علاقه‌مند هستید، لطفاً پیش از ارسال pull request، [مستندات مشارکت](./CONTRIBUTING.md) ما را مطالعه کنید.

### ساخت بر پایه OpenCode

اگر روی پروژه‌ای کار می‌کنید که به OpenCode مرتبط است و از «opencode» به‌عنوان بخشی از نام خود استفاده می‌کند، برای مثال «opencode-dashboard» یا «opencode-mobile»، لطفاً یادداشتی به README خود اضافه کنید تا روشن شود که این پروژه توسط تیم OpenCode ساخته نشده و به هیچ وجه به ما وابسته نیست.

---

**به جامعه ما بپیوندید** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
