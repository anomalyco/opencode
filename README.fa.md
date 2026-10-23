<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="لوگوی اپن‌کد">
    </picture>
  </a>
</p>
<p align="center" dir="rtl">ایجنت کدنویسی متن‌باز مبتنی بر هوش مصنوعی.</p>
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

<h3 dir="rtl">نصب</h3>

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
> <div dir="rtl">پیش از نصب، نسخه‌های قدیمی‌تر از <code>0.1.x</code> را حذف کنید.</div>

<h3 dir="rtl">برنامه دسکتاپ (بتا)</h3>

<p dir="rtl">اپن‌کد به‌صورت برنامه دسکتاپ هم در دسترس است. می‌توانید آن را مستقیماً از <a href="https://github.com/anomalyco/opencode/releases">صفحه releases</a> یا <a href="https://opencode.ai/download"><code>opencode.ai/download</code></a> دانلود کنید.</p>

<table dir="rtl">
  <thead>
    <tr>
      <th>پلتفرم</th>
      <th>فایل دانلود</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td dir="ltr">macOS (Apple Silicon)</td>
      <td dir="ltr"><code>opencode-desktop-mac-arm64.dmg</code></td>
    </tr>
    <tr>
      <td dir="ltr">macOS (Intel)</td>
      <td dir="ltr"><code>opencode-desktop-mac-x64.dmg</code></td>
    </tr>
    <tr>
      <td dir="ltr">Windows</td>
      <td dir="ltr"><code>opencode-desktop-windows-x64.exe</code></td>
    </tr>
    <tr>
      <td dir="ltr">Linux</td>
      <td dir="ltr"><code>.deb</code>، <code>.rpm</code>، یا <code>.AppImage</code></td>
    </tr>
  </tbody>
</table>

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/opencode-desktop
```

<h4 dir="rtl">مسیر نصب</h4>

<p dir="rtl">اسکریپت نصب برای انتخاب مسیر نصب از اولویت‌های زیر استفاده می‌کند:</p>

<ol dir="rtl">
  <li><code>$OPENCODE_INSTALL_DIR</code> — مسیر نصب سفارشی</li>
  <li><code>$XDG_BIN_DIR</code> — مسیر سازگار با استاندارد XDG Base Directory</li>
  <li><code>$HOME/bin</code> — پوشه استاندارد فایل‌های اجرایی کاربر، اگر وجود داشته باشد یا قابل ایجاد باشد</li>
  <li><code>$HOME/.opencode/bin</code> — مسیر پیش‌فرض جایگزین</li>
</ol>

```bash
# Examples
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

<h3 dir="rtl">ایجنت‌ها</h3>

<p dir="rtl">اپن‌کد دو ایجنت داخلی دارد که می‌توانید با کلید <code>Tab</code> بین آن‌ها جابه‌جا شوید.</p>

<ul dir="rtl">
  <li><code>build</code> — ایجنت پیش‌فرض با دسترسی کامل برای کارهای توسعه</li>
  <li><code>plan</code> — ایجنت فقط‌خواندنی برای تحلیل و بررسی کد
    <ul>
      <li>به‌طور پیش‌فرض اجازه ویرایش فایل‌ها را نمی‌دهد</li>
      <li>پیش از اجرای دستورهای <code>bash</code> اجازه می‌گیرد</li>
      <li>برای بررسی کدبیس‌های ناآشنا یا برنامه‌ریزی تغییرات مناسب است</li>
    </ul>
  </li>
</ul>

<p dir="rtl">علاوه بر این، یک ساب‌ایجنت <code>general</code> برای جست‌وجوهای پیچیده و کارهای چندمرحله‌ای وجود دارد. این ساب‌ایجنت به‌صورت داخلی استفاده می‌شود و با نوشتن <code>@general</code> در پیام‌ها قابل فراخوانی است.</p>

<p dir="rtl">اطلاعات بیشتر درباره <a href="https://opencode.ai/docs/agents">ایجنت‌ها</a>.</p>

<h3 dir="rtl">مستندات</h3>

<p dir="rtl">برای اطلاعات بیشتر درباره پیکربندی اپن‌کد، <a href="https://opencode.ai/docs"><strong>مستندات را ببینید</strong></a>.</p>

<h3 dir="rtl">مشارکت</h3>

<p dir="rtl">اگر می‌خواهید در توسعه اپن‌کد مشارکت کنید، پیش از ارسال <code>pull request</code> لطفاً <a href="./CONTRIBUTING.md">راهنمای مشارکت</a> را مطالعه کنید.</p>

<h3 dir="rtl">ساخت پروژه بر پایه اپن‌کد</h3>

<p dir="rtl">اگر روی پروژه‌ای مرتبط با اپن‌کد کار می‌کنید و در نام آن از <code>opencode</code> استفاده شده است، برای مثال <code>opencode-dashboard</code> یا <code>opencode-mobile</code>، لطفاً در فایل <code>README</code> توضیح دهید که آن پروژه توسط تیم اپن‌کد ساخته نشده و هیچ وابستگی رسمی به اپن‌کد ندارد.</p>

---

<p dir="rtl"><strong>به جامعه ما بپیوندید:</strong> <a href="https://discord.gg/opencode">Discord</a> | <a href="https://x.com/opencode">X.com</a></p>
