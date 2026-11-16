<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset=".github/assets/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset=".github/assets/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src=".github/assets/logo-ornate-light.svg" alt="OpenCode logo">
    </picture>
  </a>
</p>
<p align="center">ایجنت کدنویسی متن‌باز</p>
<p align="center">
  <a href="https://opencode.ai/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/@opencode/cli"><img alt="npm" src="https://img.shields.io/npm/v/@opencode/cli?style=flat-square" /></a>
  <a href="https://github.com/anomalyco/opencode/actions/workflows/release.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/anomalyco/opencode/release.yml?style=flat-square&branch=dev" /></a>
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
  <a href="README.fa.md">فارسی</a> |
  <a href="README.no.md">Norsk</a> |
  <a href="README.br.md">Português (Brasil)</a> |
  <a href="README.th.md">ไทย</a> |
  <a href="README.tr.md">Türkçe</a> |
  <a href="README.uk.md">Українська</a> |
  <a href="README.bn.md">বাংলা</a> |
  <a href="README.gr.md">Ελληνικά</a> |
  <a href="README.vi.md">Tiếng Việt</a>
</p>

[![OpenCode Terminal UI](services/site/public/v1/docs/assets/lander/screenshot.png)](https://opencode.ai)

---

### نصب

```bash
# YOLO
curl -fsSL https://opencode.ai/v2/install | bash

# مدیران بسته
npm i -g @opencode/cli@latest      # یا bun/pnpm/yarn
brew install anomalyco/tap/opencode-v2 # macOS و Linux (پیشنهادی، همیشه به‌روز)
brew install opencode              # macOS و Linux (فرمول رسمی brew، با به‌روز‌رسانی کمتر)
sudo pacman -S opencode            # Arch Linux (پایدار)
paru -S opencode-beta              # Arch Linux (آخرین نسخه از AUR)
mise use -g opencode               # هر سیستم‌عامل
nix run github:anomalyco/opencode  # Nix
```

> [!TIP]
> نسخه‌های قدیمی‌تر از x.0.1 را پیش از نصب پاک کنید.

### اپلیکیشن دسکتاپ (BETA)

ایجنت OpenCode به عنوان یک اپلیکیشن دسکتاپ نیز در دسترس است. آن را از [opencode.ai/download](https://opencode.ai/download) دانلود کنید.

| سیستم‌عامل              | دانلود                         |
| --------------------- | -------------------------------- |
| macOS (Apple Silicon) | `opencode-desktop-mac-arm64.dmg` |
| macOS (Intel)         | `opencode-desktop-mac-x64.dmg`   |
| Windows               | `opencode-desktop-win-x64.exe`   |
| Linux                 | `.deb`, `.rpm`, یا `.AppImage`   |

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop
```

#### مسیر نصب

اسکریپت نصب، OpenCode را در `$HOME/.opencode/bin` نصب می‌کند.

### ایجنت‌ها

اوپن‌کد دارای دو ایجنت داخلی است که می‌توانید با کلید `Tab` میان آن‌ها جابه‌جا شوید.

- **build** - پیش‌فرض، ایجنت با دسترسی کامل برای کارهای توسعه
- **plan** - ایجنت فقط‌خواندنی برای تحلیل و کاوش کد
  - به طور پیش‌فرض اجازه ویرایش فایل‌ها را نمی‌دهد.
  - پیش از اجرای دستورهای Bash درخواست مجوز می‌کند.
  - مناسب برای کاوش کدبیس‌های ناآشنا یا برنامه‌ریزی تغییرات

همچنین دارای یک ساب‌ایجنت **general** برای جستجوهای پیچیده و وظایف دارای چند گام است.
این به صورت داخلی استفاده می‌شود و می‌تواند با `@general` در پیام‌ها فراخوانده شود.

درباره [agents](https://opencode.ai/docs/agents) بیشتر بدانید.

### مستندات

برای آشنایی بیشتر با شیوه پیکربندی OpenCode، خواهشمندیم [**به مستندات ما سر بزنید**](https://opencode.ai/docs).

### همکاری

اگر علاقه‌مند به همکاری در OpenCode هستید، خواهشمندیم [راهنمای همکاری](./CONTRIBUTING.md) ما را پیش از آن که یک Pull Request ثبت کنید بخوانید.

### پروژه مرتبط با OpenCode

اگر دارید روی پروژه‌ای کار می‌کنید که به OpenCode مربوط است و در بخشی از نام آن از "opencode" استفاده می‌کنید، برای نمونه "opencode-dashboard" یا "opencode-mobile"، خواهشمندیم یک یادداشت به README خود بی‌افزایید که به طور روشن توضیح دهد که به دست گروه OpenCode ساخته نشده است و هیچ‌گونه ارتباطی با ما ندارد.

---

**به جامعه ما بپیوندید** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
