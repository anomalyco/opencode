<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logo">
    </picture>
  </a>
</p>
<p align="center" dir="rtl">סוכן קוד AI בקוד פתוח.</p>
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
  <a href="README.he.md">עברית</a>
</p>

[![OpenCode Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://opencode.ai)

---

<div dir="rtl">

### התקנה

</div>

```bash
# התקנה ישירה (YOLO)
curl -fsSL https://opencode.ai/install | bash

# מנהלי חבילות
npm i -g opencode-ai@latest        # גם bun/pnpm/yarn
scoop install opencode             # Windows
choco install opencode             # Windows
brew install anomalyco/tap/opencode # macOS ו-Linux (מומלץ, תמיד מעודכן)
brew install opencode              # macOS ו-Linux (formula רשמי, עדכונים פחות תכופים)
sudo pacman -S opencode            # Arch Linux (יציב)
paru -S opencode-bin               # Arch Linux (עדכני מ-AUR)
mise use -g opencode               # כל מערכת הפעלה
nix run nixpkgs#opencode           # או github:anomalyco/opencode לענף הפיתוח האחרון
```

<div dir="rtl">

> [!TIP]
> הסירו גרסאות ישנות (לפני 0.1.x) לפני ההתקנה.

### אפליקציית דסקטופ (BETA)

OpenCode זמין גם כאפליקציית דסקטופ. ניתן להוריד מ-[עמוד ההפצות (releases page)](https://github.com/anomalyco/opencode/releases) או מ-[opencode.ai/download](https://opencode.ai/download).

| פלטפורמה              | קישור להורדה                          |
| --------------------- | ------------------------------------- |
| macOS (Apple Silicon) | `opencode-desktop-darwin-aarch64.dmg` |
| macOS (Intel)         | `opencode-desktop-darwin-x64.dmg`     |
| Windows               | `opencode-desktop-windows-x64.exe`    |
| Linux                 | `.deb`, `.rpm`, או AppImage           |

</div>

```bash
# macOS (Homebrew Cask)
brew install --cask opencode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/opencode-desktop
```

<div dir="rtl">

#### תיקיית התקנה

סקריפט ההתקנה בוחר את נתיב ההתקנה לפי סדר העדיפויות הבא:

1. `$OPENCODE_INSTALL_DIR` — תיקיית התקנה מותאמת אישית
2. `$XDG_BIN_DIR` — נתיב לפי תקן XDG Base Directory
3. `$HOME/bin` — תיקיית הרצה סטנדרטית (אם קיימת או ניתנת ליצירה)
4. `$HOME/.opencode/bin` — נתיב גיבוי ברירת מחדל

</div>

```bash
# דוגמאות
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

<div dir="rtl">

### סוכנים (Agents)

OpenCode כולל שני סוכנים מובנים. ניתן לעבור ביניהם באמצעות מקש `Tab`.

- **build** — מצב ברירת המחדל, סוכן עם הרשאות מלאות, מתאים לפיתוח.
- **plan** — מצב קריאה בלבד, מתאים לניתוח קוד וחקירה.
  - לא ניתן לשנות קבצים כברירת מחדל.
  - מבקש אישור לפני הרצת פקודות bash.
  - מתאים מצוין לחקירת בסיסי קוד חדשים או תכנון שינויים.

בנוסף, OpenCode כולל סוכן משנה בשם **general** לטיפול בחיפושים מורכבים ומשימות מרובות שלבים. סוכן זה מיועד לשימוש פנימי, אך ניתן להפעיל אותו ידנית על ידי הקלדת `@general` בהודעה.

למידע נוסף על [סוכנים](https://opencode.ai/docs/agents).

### תיעוד מקוון

למידע מפורט על הגדרת OpenCode, עיינו ב-[**תיעוד הרשמי**](https://opencode.ai/docs).

### תרומה לפרויקט

אם אתם מעוניינים לתרום לפיתוח OpenCode, אנא קראו את [מדריך התרומה (Contributing Docs)](./CONTRIBUTING.md) לפני שליחת Pull Request.

### פיתוח על בסיס OpenCode

אם אתם מפתחים פרויקט הקשור ל-OpenCode ומשתמשים בשם "opencode" (למשל "opencode-dashboard" או "opencode-mobile"), אנא ציינו ב-README שלכם שהפרויקט אינו מפותח על ידי צוות OpenCode ואינו קשור אלינו.

### שאלות נפוצות (FAQ)

#### מה ההבדל בין זה ל-Claude Code?

מבחינה פונקציונלית, דומה מאוד ל-Claude Code. הנה ההבדלים העיקריים:

- קוד פתוח ב-100%.
- לא תלוי בספק מסוים. אנחנו ממליצים על המודלים שזמינים דרך [OpenCode Zen](https://opencode.ai/zen), אך OpenCode עובד גם עם Claude, OpenAI, Google ואפילו מודלים מקומיים. ככל שהמודלים מתפתחים, הפערים ביניהם מצטמצמים והמחירים יורדים — לכן אי-תלות בספק היא קריטית.
- תמיכה מובנית ב-LSP (Language Server Protocol).
- דגש על ממשק טרמינל (TUI). OpenCode נבנה על ידי חובבי Neovim ויוצרי [terminal.shop](https://terminal.shop). אנחנו נמשיך לדחוף את גבולות ממשק הטרמינל.
- ארכיטקטורת לקוח/שרת (Client/Server). מאפשרת ל-OpenCode לרוץ על המחשב שלכם ולשלוט בו מרחוק ממכשיר נייד. המשמעות היא שממשק ה-TUI הוא רק אחד מלקוחות אפשריים רבים.

---

**הצטרפו לקהילה שלנו** [Discord](https://opencode.ai/discord) | [X.com](https://x.com/opencode)

</div>
