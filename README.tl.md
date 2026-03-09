<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logo">
    </picture>
  </a>
</p>
<p align="center">Ang open source na AI coding agent.</p>
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

# Mga Package Manager
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
> Alisin ang mga bersyong mas luma sa 0.1.x bago i-install.

### Aplikasyon sa Desktop (BETA)

Makukuha rin ang OpenCode bilang aplikasyon sa desktop. I-download nang direkta mula sa [releases page](https://github.com/anomalyco/opencode/releases) o [opencode.ai/download](https://opencode.ai/download).

| Plataforma            | I-download                            |
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

#### Direktoryo ng Pag-install

Iginagalang ng install script ang sumusunod na pagkakasunud-sunod ng prayoridad para sa landas ng pag-install:

1. `$OPENCODE_INSTALL_DIR` - Pasadyang direktoryo ng pag-install
2. `$XDG_BIN_DIR` - Landas na sumusunod sa espesipikasyon ng XDG Base Directory
3. `$HOME/bin` - Karaniwang direktoryo ng binary ng gumagamit (kung mayroon o maaaring malikha)
4. `$HOME/.opencode/bin` - Default na fallback

```bash
# Halimbawa
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### Agents

Kasama sa OpenCode ang dalawang nakapaloob na agent na maaari mong magamit sa pamamagitan ng `Tab` key.

- **build** - Default, kumpletong access sa agent para sa mga gawaing pag buo
- **plan** - Read-only agent para sa pagsusuri at paggalugad ng code
  - Tinatanggihan ang mga pag-edit ng file bilang default
  - Humihingi ng pahintulot bago patakbuhin ang mga utos ng bash
  - Mainam para sa paggalugad ng mga hindi pamilyar na codebase o pagpaplano ng mga pagbabago

Kasama rin ang isang **general** subagent para sa mga kumplikadong paghahanap at mga gawaing may maraming hakbang.
Ginagamit ito sa loob at maaaring gamitin sa pamamagitan ng `@general` sa mensahe.

Matuto nang higit pa tungkol sa [agents](https://opencode.ai/docs/agents).

### Dokumentasyon

Para sa karagdagang impormasyon kung paano i-configure ang OpenCode, [**head over to our docs**](https://opencode.ai/docs).

### Kontribusyon

Kung interesado kang mag-ambag sa OpenCode, pakibasa ang aming [mga dokumentong nag-aambag](./CONTRIBUTING.md) bago magsumite ng pull request.

### Pagbuo gamit ang OpenCode

Kung ikaw ay nagtatrabaho sa isang proyektong may kaugnayan sa OpenCode at ginagamit ang "opencode" bilang bahagi ng pangalan nito, halimbawa "opencode-dashboard" o "opencode-mobile", mangyaring magdagdag ng tala sa iyong README upang linawin na hindi ito ginawa ng pangkat ng OpenCode at hindi kaakibat sa amin sa anumang paraan.

### Mga Madalas Itanong

#### Paano ito naiiba sa Claude Code?

Ito ay halos kapareho ng Claude Code sa usapin ng kakayahan. Narito ang mga pangunahing pagkakaiba:

- 100 poryestong open source
- Hindi konektado sa kahit anong provider. Bagama't inirerekomenda namin ang mga modelong ibinibigay namin sa pamamagitan ng [OpenCode Zen](https://opencode.ai/zen), maaaring gamitin ang OpenCode kasama ng Claude, OpenAI, Google, o kahit ng mga lokal na modelo. Habang umuunlad ang mga modelo, magsasara ang mga agwat sa pagitan ng mga ito at bababa ang presyo, kaya mahalaga ang pagiging agnostiko sa provider.
- Agad na supporta sa LSP
- Nakatuon sa TUI. Ang OpenCode ay binuo ng mga gumagamit ng neovim at ng mga tagalikha ng [terminal.shop](https://terminal.shop); susubukan naming lampasan ang mga limitasyon ng kung ano ang posible sa terminal.
- Isang arkitektura ng kliyente/server. Halimbawa, maaari nitong payagan ang OpenCode na tumakbo sa iyong computer habang ginagamit mo ito nang malayuan mula sa isang mobile app, ibig sabihin ang TUI frontend ay isa lamang sa mga posibleng kliyente.

---

**Sumali sa aming komunidad** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
