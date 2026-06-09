<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logo">
    </picture>
  </a>
</p>
<p align="center">ክፍት ምንጭ (open source) የሆነው የ-AI ኮድ ማድረጊያ ኤጀንት።</p>
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
  <a href="README.am.md">አማርኛ</a>
</p>

[![OpenCode Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://opencode.ai)

---

### አጫጫን (Installation)

```bash
# YOLO
curl -fsSL https://opencode.ai/install | bash

# የጥቅል አስተዳዳሪዎች (Package managers)
npm i -g opencode-ai@latest         # ወይም bun/pnpm/yarn
scoop install opencode             # ለዊንዶውስ (Windows)
choco install opencode             # ለዊንዶውስ (Windows)
brew install anomalyco/tap/opencode # ለማክኦኤስ እና ሊኑክስ (macOS and Linux) (የሚመከር፣ ሁልጊዜ ወቅታዊ)
brew install opencode              # ለማክኦኤስ እና ሊኑክስ (macOS and Linux) (ይፋዊው የ-brew ፎርሙላ፣ ብዙም የማይዘመን)
sudo pacman -S opencode            # ለአርች ሊኑክስ (Arch Linux) (የተረጋጋ/Stable)
paru -S opencode-bin               # ለአርች ሊኑክስ (Arch Linux) (የቅርብ ጊዜው ከ-AUR)
mise use -g opencode               # ለማንኛውም ኦፕሬቲንግ ሲስተም (Any OS)
nix run nixpkgs#opencode           # ወይም ለቅርብ ጊዜው የዴቨሎፕመንት ቅርንጫፍ github:anomalyco/opencode ይጠቀሙ
```

> [!ጠቃሚ ምክር]
> ከመጫንዎ በፊት ከ 0.1.x የቀደሙ የድሮ ስሪቶችን ያስወግዱ።

### የዴስክቶፕ መተግበሪያ (BETA)

OpenCode በዴስክቶፕ መተግበሪያነትም ይገኛል። በቀጥታ ከ [የስሪቶች ገጽ (releases page)](https://github.com/anomalyco/opencode/releases) ወይም ከ [opencode.ai/download](https://opencode.ai/download) ማውረድ ይችላሉ።

| Platform              | Download                           |
| --------------------- | ---------------------------------- |
| macOS (Apple Silicon) | `opencode-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `opencode-desktop-mac-x64.dmg`     |
| Windows               | `opencode-desktop-windows-x64.exe` |
| Linux                 | `.deb`, `.rpm`, ወይም `.AppImage`    |

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/opencode-desktop
```

#### የመጫኛ ማውጫ (Installation Directory)

የመጫኛ ስክሪፕቱ ለመጫኛ መንገዱ የሚከተለውን የቅድሚያ ቅደም ተከተል ይከተላል፦

1. `$OPENCODE_INSTALL_DIR` - የተለየ የመጫኛ ማውጫ
2. `$XDG_BIN_DIR` - ከ XDG Base Directory Specification ጋር የሚስማማ መንገድ
3. `$HOME/bin` - መደበኛ የተጠቃሚ ባይነሪ ማውጫ (የነበረ ወይም ሊፈጠር የሚችል ከሆነ)
4. `$HOME/.opencode/bin` - ነባሪ አማራጭ ማውጫ

```bash
# ምሳሌዎች
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL [https://opencode.ai/install](https://opencode.ai/install) | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL [https://opencode.ai/install](https://opencode.ai/install) | bash
```

### ኤጀንቶች (Agents)

OpenCode በ `Tab` ቁልፍ አማካኝነት አንዱን ወደ ሌላው መቀያየር የሚችሉባቸው ሁለት አብረው የተሰሩ ኤጀንቶችን ያካትታል።

- **build** - ለልማት (development) ሥራ የሚያገለግል፣ ሙሉ መዋቅርን የመቀየር ፈቃድ ያለው ነባሪ ኤጀንት ነው።
- **plan** - ለትንተና እና ኮድን ለማሰስ የሚያገለግል፣ የማንበብ ብቻ (Read-only) ፈቃድ ያለው ኤጀንት ነው።
  - በነባሪነት ፋይሎችን ማረም ወይም መቀየር አይፈቅድም
  - የ bash ትዕዛዞችን ከማስኬዱ በፊት ፈቃድ ይጠይቃል
  - አዲስ ወይም የማያውቁትን የኮድ ስብስቦች (codebases) ለማሰስ ወይም ለውጦችን ለማቀድ ተመራጭ ነው

በተጨማሪም ለተወሳሰቡ ፍለጋዎች እና ባለብዙ-ደረጃ ተግባራት የሚያገለግል **general** የተሰኘ ንዑስ-ኤጀንት (subagent) ተካቷል።
ይህ ኤጀንት በውስጣዊ አሠራር ላይ የሚጠቅም ሲሆን በመልዕክቶችዎ ውስጥ `@general` በማለት ሊጠሩት ይችላሉ።

ስለ [ኤጀንቶች (agents)](https://opencode.ai/docs/agents) የበለጠ ይረዱ።

### ሰነዶች (Documentation)

OpenCodeን እንዴት ማዋቀር እንደሚቻል ለበለጠ መረጃ [**ወደ ሰነዶቻችን ገጽ ይሂዱ**](https://opencode.ai/docs)።

### አስተዋጽኦ ማበርከት (Contributing)

በOpenCode ላይ አስተዋጽኦ ለማበርከት ፍላጎት ካለዎት፣ እባክዎ ጥያቄ (pull request) ከማስገባትዎ በፊት [የአስተዋጽኦ ሰነዶቻችንን](./CONTRIBUTING.md) ያንብቡ።

### በOpenCode ላይ መገንባት (Building on OpenCode)

ከOpenCode ጋር የተያያዘ እና "opencode" የሚለውን ቃል በስሙ ውስጥ የሚጠቀም ፕሮጀክት ላይ እየሰሩ ከሆነ (ለምሳሌ "opencode-dashboard" ወይም "opencode-mobile")፣ እባክዎ ፕሮጀክቱ በOpenCode ቡድን ያልተገነባ እና ከእኛ ጋር በምንም መልኩ ግንኙነት የሌለው መሆኑን ግልጽ ለማድረግ በ README ፋይልዎ ላይ ማስታወሻ ያክሉ።

---

**ማህበረሰባችንን ይቀላቀሉ** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
