<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="لوگو OpenCode">
    </picture>
  </a>
</p>
<p align="center">دستیار هوش مصنوعی متن باز.</p>
<p align="center">
  <a href="https://opencode.ai/discord"><img alt="دیسگورد" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/opencode-ai"><img alt="npm" src="https://img.shields.io/npm/v/opencode-ai?style=flat-square" /></a>
  <a href="https://github.com/anomalyco/opencode/actions/workflows/publish.yml"><img alt="وضعبت ساخت" src="https://img.shields.io/github/actions/workflow/status/anomalyco/opencode/publish.yml?style=flat-square&branch=dev" /></a>
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
  <a href="README.fa.md">فارسی</a>
</p>

[![OpenCode Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://opencode.ai)

---

### نصب

```bash
# (YOLO)روش سریع
curl -fsSL https://opencode.ai/install | bash

# بسته های نصبی
npm i -g opencode-ai@latest        # یا bun/pnpm/yarn
scoop install opencode             # ویندوز
choco install opencode             # ویندوز
brew install anomalyco/tap/opencode # مک،لینوکس (پیشنهادی -همیشه برور)
brew install opencode              # مک،لینوکس(بروزرسانی کمتر، brew فرمول نویسی رسمی)
sudo pacman -S opencode            # آرچ لینوکس (نسخه چایدار)
paru -S opencode-bin               # آرچ لینوکس (آخرین نسخه از AUR)
mise use -g opencode               # هر سیستم عاملی
nix run nixpkgs#opencode           # یا github:anomalyco/opencode آخرین شاخه dev
```

> [!توجه]
>قبل از نصب نسخه های قدیمی تر از 0.1.x حذف کنید

### اپلیکیشن ویندوز (نسخه آزمایشی)

  opencode  علاوه بر نسخه خط فرمان (ترمینالی) نسخه ویندوزی هم دارد [ صفحه انتشار نسخه ها](https://github.com/anomalyco/opencode/releases) و یا [وبسایت رسمی](https://opencode.ai/download).

| پلتفرم                | دانلود                               |
| --------------------- | ------------------------------------- |
| macOS (Apple Silicon) | `opencode-desktop-darwin-aarch64.dmg` |
| macOS (Intel)         | `opencode-desktop-darwin-x64.dmg`     |
| Windows               | `opencode-desktop-windows-x64.exe`    |
| Linux                 | `.deb` یا `.rpm` یا AppImage          |

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop
# ویندوز (Scoop)
scoop bucket add extras; scoop install extras/opencode-desktop
```

#### مسیر نصب  

اسکریپت نصب، طبق اولویت زیر مسیر نصب را مشخص میکنه:

1. `$OPENCODE_INSTALL_DIR` - مسیر سفارشی
2. `$XDG_BIN_DIR` - مسیر مطابق با مشخصات  XDG Base Directory
3. `$HOME/bin` - پوشه استاندارد باینری کاربر (در صورتی که این قابلیت اضافه شده باشه)
4. `$HOME/.opencode/bin` - مسیر پیش فرض جایگزین

```bash
# مثال
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### دستیار (agent)
 برنامه دارای دو نوع دستیار  اصلی داخلی است که با کلید `Tab` میتونید بین انها سوییچ کنید

- **ساخت (build)** - دستیار پیش فرض با دسترسی کامل برای کارهای توسعه
- **برنامه‌ ریزی (plan)** - دستیار با دسترسی فقط خواندن برای تحلیل و برسی کد
  - به صور پیشفرض ویرایش فایل ها را رد میکنه   
  - قبل از اجرای دستورات bash نیاز به دسترسی داره
  - برای درک سورس کدهای جدید یا برنامه ریزی قبل از تغییرات خوبه

همپنین علاوه بر اینها یه زیر مجموعه عمومی با نام **general** وجود داره که برای جستجوهای پیجیده و وظایف چندمرحله ای   فراخوانی میشه `@general`کاربردی هست و از داخل محیط چت با دستور 
برای مطالعه بیشتر دو مورد دستیار ها  به مستندات مراحعه کنید[دستیارها](https://opencode.ai/docs/agents).

### مستندات

برای اطلاعات بیشتر درباره نحوهٔ پیکربندی OpenCode، [**به مستندات مراجعه کنید**](https://opencode.ai/docs).

### مشارکت

اگر به مشارکت در OpenCode علاقه‌ دارید، لطفاً قبل از ارسال درخواست pull، [مستندات مشارکت](./CONTRIBUTING.md) را مطالعه کنید.

### ساخت پروژه بر پایهٔ OpenCode

> **توجه:** اگر پروژه‌ای با نام  "opencode" (مثل `opencode-dashboard` یا    `opencode-mobile`) توسعه می‌دهید، لطفاً در README  ذکر کنید که این پروژه **وابسته به تیم OpenCode نبوده** و توسط آن‌ها پشتیبانی نمیشه.

### سوالات متداول

#### این چه فرقی با مدل های ابری داره؟

از نظر قابلیت‌ ها خیلی شبیه به مدل های ابری است. در اینجا تقاوت های کلیدی نوشته شده:

- ۱۰۰٪ متن‌باز (Open Source)
- به هیچ اراده دهنده ای وابستگی نداره. هرچند که توصیه میکنیم از مدل های پیش فرض [OpenCode Zen](https://opencode.ai/zen) استفاده کنید ولی میتونید از مدل های ابری مانند گوگل- open ai یا کلاد استفاده کنید و همینطور از مدل های لوکال 
- پشتیبانی داخلی از LSP
- تمرکز رئی محیط ترمینال- OpenCode افرادی ساهتند که عاشق neovim هستند و همان کسانی که [terminal.shop] (https://terminal.shop) را توسعه دادن.ما میخوایم نشون بدیم که ترمینال چقدر قدرتمنده و کارهایی که با اون میشه انجام داد و به حداکثر برسونیم
- معماری کلاینت سرور - یعنی OpenCode روی ویندوز نصب کنید و یا موبایل یا سیستم دیگه از راه دور اونو کنترل کنید، این یکی از حالت هایی هست که در ترمینال میبینید

---

**ه جمع ما ملحق شوید** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
