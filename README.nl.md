<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logo">
    </picture>
  </a>
</p>
<p align="center">De open source AI coding agent.</p>
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
  <a href="README.nl.md">Dutch/Nederlands</a>
</p>

[![OpenCode Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://opencode.ai)

---

### Installatie

```bash
# YOLO
curl -fsSL https://opencode.ai/install | bash

# Package managers
npm i -g opencode-ai@latest        # of bun/pnpm/yarn
scoop install opencode             # Windows
choco install opencode             # Windows
brew install anomalyco/tap/opencode # macOS en Linux (aangeraden, altijd up-to-date)
brew install opencode              # macOS en Linux (officiële Homebrew-formule, minder up-to-date)
sudo pacman -S opencode            # Arch Linux (Stabiel)
paru -S opencode-bin               # Arch Linux (Meest recente van AUR)
mise use -g opencode               # Elk OS
nix run nixpkgs#opencode           # of github:anomalyco/opencode voor de dev branch
```

> [!TIP]
> Verwijder versies ouder dan 0.1.x voor installatie.

### Desktop-app (BETA)

OpenCode is ook beschikbaar als desktopapplicatie. Download direct van de [releases-pagina](https://github.com/anomalyco/opencode/releases) of [opencode.ai/download](https://opencode.ai/download).

| Platform              | Download                              |
| --------------------- |---------------------------------------|
| macOS (Apple Silicon) | `opencode-desktop-darwin-aarch64.dmg` |
| macOS (Intel)         | `opencode-desktop-darwin-x64.dmg`     |
| Windows               | `opencode-desktop-windows-x64.exe`    |
| Linux                 | `.deb`, `.rpm`, of AppImage           |

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/opencode-desktop
```

#### Installation Directory

Het installatiescript respecteert de volgende prioriteitsvolgorde voor het installatiepad:

1. `$OPENCODE_INSTALL_DIR` - Aangepaste installatiemap
2. `$XDG_BIN_DIR` - XDG Base Directory Specification-compatibel pad
3. `$HOME/bin` - Standaard gebruikersmap voor binaries (als die bestaat of kan worden aangemaakt)
4. `$HOME/.opencode/bin` - Standaard terugvaloptie

```bash
# Voorbeelden
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### Agents

OpenCode bevat twee ingebouwde agents waar je met de `Tab` toets tussen kunt wisselen.

- **build** - Standaard agent met volledige toegang voor ontwikkelingsdoeleinden.
- **plan** - Agent met leesrechten voor analytische taken en codeverkenning
  - Weigert standaard bestandsaanpassingen
  - Vraagt om goedkeuring voor het uitvoeren van bash-commando's
  - Ideaal voor het verkennen van onbekende codebases of het plannen van wijzigingen

Ook bevat het een **general** subagent voor complexe zoekopdrachten en taken met meerdere stappen.
Deze wordt intern gebruikt en kan aangeroepen worden met `@general` in een chat.

Leer meer over [agents](https://opencode.ai/docs/agents).

### Documentatie

Voor meer informatie over het instellen van OpenCode, [**zie onze documentatie**](https://opencode.ai/docs).

### Bijdragen

Als je wil bijdragen aan OpenCode, lees onze [contributing docs](./CONTRIBUTING.md) voordat je een pull request aanmaakt.

### Bouwen op OpenCode

Ben je aan het werken aan een project dat gerelateerd is aan OpenCode en "opencode" in de naam heeft, bijvoorbeeld "opencode-dashboard" of "opencode-mobile"? Voeg dan een notitie toe aan de README om toe te lichten dat dit niet is gebouwd door het OpenCode-team en op geen enkele manier gelieerd is aan OpenCode.

### FAQ

#### Hoe is dit anders dan Claude Code?

Het lijkt qua functionaliteit sterk op Claude Code. Dit zijn de belangrijkste verschillen:

- 100% open source
- Niet gebonden aan een provider. Hoewel we de modellen uit [OpenCode Zen](https://opencode.ai/zen) aanbevelen, kan OpenCode gebruikt worden met Claude, OpenAI, Google of zelfs lokale modellen. Naarmate modellen evolueren, worden de verschillen kleiner en dalen de prijzen; daarom is provider-onafhankelijkheid belangrijk.
- Out-of-the-box LSP-ondersteuning
- Een focus op TUI. OpenCode is gebouwd door Neovim-gebruikers en de makers van [terminal.shop](https://terminal.shop); we gaan de grenzen opzoeken van wat mogelijk is in een terminal.
- Een client/server architectuur. Dit maakt het bijvoorbeeld mogelijk dat OpenCode op je computer draait terwijl je het op afstand bedient vanuit een mobiele app, wat betekent dat de TUI-frontend slechts een van de mogelijke clients is.
---

**Word lid van onze community** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
