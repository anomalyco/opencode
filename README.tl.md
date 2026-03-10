<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logo">
    </picture>
  </a>
</p>
<p align="center">Isang AI na ahente sa coding na bukas para sa lahat.</p>
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
  <a href="README.gr.md">Ελληνικά</a>
  <a href="README.tl.md">Tagalog</a>
</p>

[![OpenCode Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://opencode.ai)

---

### Pag-install

```bash
# YOLO
curl -fsSL https://opencode.ai/install | bash

# Mga Tagapamahala ng Package
npm i -g opencode-ai@latest         # o bun/pnpm/yarn
scoop install opencode              # Windows
choco install opencode              # Windows
brew install anomalyco/tap/opencode # macOS at Linux (inirerekomenda sapagkat laging napapanahon)
brew install opencode               # macOS at Linux (opisyal na brew pormula, mas bihira ang update)
sudo pacman -S opencode             # Arch Linux (Laging napapanahon)
paru -S opencode-bin                # Arch Linux (pinaka bago mula AUR)
mise use -g opencode                # kahit anong OS
nix run nixpkgs#opencode            # o github:anomalyco/opencode para sa napapanahong dev branch
```

> [!TIP]
> Tanggalin ang mga bersyong mas mababa sa 0.1.x bago mag-install.

### Aplikasyon sa Desktop (BETA)

Magagamit din ang OpenCode bilang desktop na aplikasyon. I-download ito nang direkta mula sa [releases page](https://github.com/anomalyco/opencode/releases) o [opencode.ai/download](https://opencode.ai/download).

| Sistemang Operatibo   | Pag-download                          |
| --------------------- | ------------------------------------- |
| macOS (Apple Silicon) | `opencode-desktop-darwin-aarch64.dmg` |
| macOS (Intel)         | `opencode-desktop-darwin-x64.dmg`     |
| Windows               | `opencode-desktop-windows-x64.exe`    |
| Linux                 | `.deb`, `.rpm`, o AppImage            |

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/opencode-desktop
```

#### Lokasyon ng Pag-install

Ang skript ng pag-install ay sumusunod sa ganitong prayoridad para sa lokasyon ng pag-install:

1. `$OPENCODE_INSTALL_DIR` - Pasadyang lokasyon ng pag-install
2. `$XDG_BIN_DIR` - Landas na sumusunod sa pamantayan ng XDG Base Directory
3. `$HOME/bin` - Karaniwang lokasyon ng mga binary ng gumagamit (kung mayroon o puwedeng malikha)
4. `$HOME/.opencode/bin` - Default na fallback

```bash
# Halimbawa
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### Mga Agent

Kasama sa OpenCode ang dalawang built-in na agent na maaari mong gamitin gamit ang `Tab` key:

- **build** – Default agent na may kumpletong access para sa mga gawaing pagbuo
- **plan** – Read-only na agent para sa pagsusuri at paggalugad ng code
  - Hindi pinapayagang mag-edit ng mga file bilang default
  - Humihingi ng pahintulot bago patakbuhin ang mga utos ng bash
  - Mainam para sa paggalugad ng hindi pamilyar na codebase o pagpaplano ng mga pagbabago

Kasama rin ang isang **general** subagent para sa mga kumplikadong paghahanap at gawaing may maraming hakbang.  
Ginagamit ito sa loob at maaaring tawagin gamit ang `@general` sa mga mensahe.

Matuto nang higit pa tungkol sa [agents](https://opencode.ai/docs/agents).

### Dokumentasyon

Para sa karagdagang impormasyon kung paano i-configure ang OpenCode, bisitahin ang aming [dokumentasyon](https://opencode.ai/docs).

### Kontribusyon

Kung nais mong mag-ambag sa OpenCode, basahin muna ang aming [mga dokumentong nag-aambag](./CONTRIBUTING.md) bago magsumite ng pull request.

### Pagbuo gamit ang OpenCode

Kung nagtatrabaho ka sa proyektong may kaugnayan sa OpenCode at ginagamit ang "opencode" sa pangalan nito, tulad ng "opencode-dashboard" o "opencode-mobile", maglagay ng paalala sa iyong README upang linawin na hindi ito ginawa ng koponan ng OpenCode at hindi kaakibat sa amin.

### Mga Kadalasang Tanong

#### Paano naiiba ang OpenCode sa Claude Code?

Halos pareho ang OpenCode sa Claude Code sa kakayahan, ngunit narito ang mga pangunahing pagkakaiba:

- 100% bukas na pinagmulan
- Hindi nakadepende sa anumang provider. Bagama’t inirerekomenda namin ang mga modelong makukuha sa pamamagitan ng [OpenCode Zen](https://opencode.ai/zen), puwede mong gamitin ang OpenCode kasama ng Claude, OpenAI, Google, o lokal na mga modelo. Habang umuunlad ang mga modelo, magsasara ang mga agwat at bababa ang presyo, kaya mahalaga ang pagiging provider-agnostic.
- Agad na suporta para sa LSP
- Nakatuon sa TUI. Ang OpenCode ay binuo ng mga gumagamit ng neovim at ng mga tagalikha ng [terminal.shop](https://terminal.shop), layunin naming lampasan ang mga limitasyon ng terminal.
- May arkitektura ng kliyente/server. Halimbawa, puwede nitong patakbuhin ang OpenCode sa iyong computer habang ginagamit mo ito nang malayuan mula sa aplikasyon sa telepono, ibig sabihin, ang TUI frontend ay isa lamang sa maraming posibleng kliyente.

---

**Sumali sa aming komunidad** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
