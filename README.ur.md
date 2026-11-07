<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logo">
    </picture>
  </a>
</p>
<p align="center">اوپن سورس اے آئی کوڈنگ ایجنٹ۔</p>
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
  <a href="README.no.md">Norsk</a> |
  <a href="README.br.md">Português (Brasil)</a> |
  <a href="README.th.md">ไทย</a> |
  <a href="README.tr.md">Türkçe</a> |
  <a href="README.uk.md">Українська</a> |
  <a href="README.bn.md">বাংলা</a> |
  <a href="README.gr.md">Ελληνικά</a> |
  <a href="README.vi.md">Tiếng Việt</a> |
  <a href="README.hi.md">हिन्दी</a> |
  <a href="README.ur.md">اردو</a>
</p>

[![OpenCode Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://opencode.ai)

---

### انسٹالیشن (Installation)

```bash
# YOLO
curl -fsSL https://opencode.ai/v2/install | bash

# پیکیج مینیجرز
npm i -g @opencode/cli@latest      # یا bun/pnpm/yarn
brew install anomalyco/tap/opencode-v2 # macOS اور Linux (تجویز کردہ، ہمیشہ اپ ٹو ڈیٹ)
brew install opencode              # macOS اور Linux (آفیشل brew فارمولا، کم اپ ڈیٹس)
sudo pacman -S opencode            # Arch Linux (مستحکم)
paru -S opencode-beta              # Arch Linux (AUR سے تازہ ترین)
mise use -g opencode               # کوئی بھی OS
nix run github:anomalyco/opencode  # Nix
```

> [!TIP]
> انسٹال کرنے سے پہلے 0.1.x سے پرانے ورژنز ہٹا دیں۔

### ڈیسک ٹاپ ایپ (BETA)

OpenCode ڈیسک ٹاپ ایپلیکیشن کے طور پر بھی دستیاب ہے۔ اسے [opencode.ai/download](https://opencode.ai/download) سے ڈاؤن لوڈ کریں۔

| پلیٹ فارم             | ڈاؤن لوڈ                            |
| --------------------- | ---------------------------------- |
| macOS (Apple Silicon) | `opencode-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `opencode-desktop-mac-x64.dmg`     |
| Windows               | `opencode-desktop-win-x64.exe`     |
| Linux                 | `.deb`، `.rpm`، یا `.AppImage`     |

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop
```

#### انسٹالیشن ڈائریکٹری (Installation Directory)

انسٹال اسکرپٹ OpenCode کو `$HOME/.opencode/bin` میں انسٹال کرتی ہے۔

### ایجنٹس (Agents)

OpenCode میں دو بلٹ ان ایجنٹس شامل ہیں جن کے درمیان آپ `Tab` کی (key) سے سوئچ کر سکتے ہیں۔

- **build** - ڈیفالٹ، ڈویلپمنٹ کے کام کے لیے مکمل رسائی والا ایجنٹ
- **plan** - تجزیہ اور کوڈ ایکسپلوریشن کے لیے صرف پڑھنے کے لیے (read-only) ایجنٹ
  - ڈیفالٹ طور پر فائل میں ترمیم کی اجازت نہیں دیتا
  - بیش (bash) کمانڈز چلانے سے پہلے اجازت طلب کرتا ہے
  - غیر مانوس کوڈ بیس کو سمجھنے یا تبدیلیوں کی منصوبہ بندی کے لیے بہترین

اس کے علاوہ پیچیدہ تلاش اور کثیر مرحلہ کاموں کے لیے ایک **general** سب ایجنٹ بھی شامل ہے۔
یہ اندرونی طور پر استعمال ہوتا ہے اور پیغامات میں `@general` لکھ کر اسے کال کیا جا سکتا ہے۔

[ایجنٹس](https://opencode.ai/v2/docs/agents) کے بارے میں مزید جانیں۔

### دستاویزات (Documentation)

OpenCode کو کنفیگر کرنے کے طریقے کے بارے میں مزید معلومات کے لیے، [**ہماری دستاویزات دیکھیں**](https://opencode.ai/v2/docs)۔

### تعاون (Contributing)

اگر آپ OpenCode میں حصہ ڈالنے میں دلچسپی رکھتے ہیں، تو براہ کرم پل ریکویسٹ جمع کروانے سے پہلے ہماری [تعاون کی دستاویزات](./CONTRIBUTING.md) پڑھیں۔

### OpenCode پر تعمیر (Building on OpenCode)

اگر آپ کسی ایسے پروجیکٹ پر کام کر رہے ہیں جو OpenCode سے متعلق ہے اور اپنے نام کے حصے کے طور پر "opencode" کا استعمال کر رہا ہے، مثلاً "opencode-dashboard" یا "opencode-mobile"، تو براہ کرم اپنے README میں ایک نوٹ شامل کر کے واضح کریں کہ یہ OpenCode ٹیم کی طرف سے نہیں بنایا گیا ہے اور کسی بھی طرح سے ہمارے ساتھ منسلک نہیں ہے۔

---

**ہماری کمیونٹی میں شامل ہوں** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
