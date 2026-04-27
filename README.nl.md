<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logo">
    </picture>
  </a>
</p>
<p align="center">De opensource AI programmeeragent.</p>
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
  <a href="README.nl.md">Nederlands</a> |
  <a href="README.no.md">Norsk</a> |
  <a href="README.br.md">Português (Brasil)</a> |
  <a href="README.th.md">ไทย</a> |
  <a href="README.tr.md">Türkçe</a> |
  <a href="README.uk.md">Українська</a> |
  <a href="README.bn.md">বাংলা</a> |
  <a href="README.gr.md">Ελληνικά</a> |
  <a href="README.vi.md">Tiếng Việt</a>
</p>

[![OpenCode Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://opencode.ai)

---

### Installation

```bash
# YOLO
curl -fsSL https://opencode.ai/install | bash

# Package managers
npm i -g opencode-ai@latest        # of bun/pnpm/yarn
scoop install opencode             # Windows
choco install opencode             # Windows
brew install anomalyco/tap/opencode # macOS en Linux (aanbevolen, altijd de laatste versie)
brew install opencode              # macOS en Linux (officiële brew optie, minder geüpdated)
sudo pacman -S opencode            # Arch Linux (Stabiel)
paru -S opencode-bin               # Arch Linux (Nieuwste van AUR)
mise use -g opencode               # Eender welk OS
nix run nixpkgs#opencode           # of github:anomalyco/opencode voor de nieuwste dev branch
```

> [!TIP]
> Verwijder versies ouder dan 0.1.x voor de installatie.

### Desktop App (BETA)

OpenCode is ook beschikbaar als a desktop applicatie. Download het rechtstreeks van de [releases pagina](https://github.com/anomalyco/opencode/releases) of [opencode.ai/download](https://opencode.ai/download).

| Platform              | Download                              |
| --------------------- | ------------------------------------- |
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
2. `$XDG_BIN_DIR` - Pad conform de XDG Base Directory Specification
3. `$HOME/bin` - Standaardmap voor binaire bestanden van de gebruiker (indien deze bestaat of kan worden aangemaakt)
4. `$HOME/.opencode/bin` - Standaard fallback

```bash
# Voorbeelden
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### Agents

OpenCode bevat twee ingebouwde agents waartussen u kunt schakelen met de `Tab`-toets.

- **build** - Standaard, volledige toegang agent voor ontwikkelen
- **plan** - Alleen-lezen agent voor analyses en codeverkenning
  - Standaard weigert bestandsaanpassingen 
  - Vraagt uw toestemming voor het uitvoeren van bashcommando's
  - Ideaal voor onbekende codebases te ontdekken of het plannen van wijzigingen 

Ook bijgevoegd is een **algemene** subagent voor complexe zoekopdrachten en taken met vele stappen.
Dit wordt intern gebruikt en kan worden opgeroepen met `@general` in berichten.

Meer lezen over [agents](https://opencode.ai/docs/agents).

### Documentatie

Voor meer info over het configureren van OpenCode, [**verwijzen we u graag door naar onze docs**](https://opencode.ai/docs).

### Contributie

Indien u geïnteresseerd bent in het bijdragen aan OpenCode, lees dan alvast onze [contributing docs](./CONTRIBUTING.md) voor het indienen van een Pull Request.

### Bouwen op OpenCode

Indien u werkt aan een project dat gerelateerd is aan OpenCode en 'opencode' gebruikt als deel van zijn naam, bijvoorbeeld "opencode-dashboard" of 'opencode-op-uwe-gsm', voeg dan alstublieft een opmerking aan je README toe om te verduidelijken dat het niet door het OpenCode team gebouwd is en op geen enkele manier aan ons gelieerd is.

### Veelgestelde vragen

#### Op welke manier verschilt dit van Claude Code?

Het lijkt vrij veel op Claude Code op vlak van wat het kan. Hier zijn de grootste verschillen:

- 100% opensource
- Niet gebonden aan één provider. We raden echter de modellen die wij aanbieden door [OpenCode Zen](https://opencode.ai/zen) aan. OpenCode kan worden gebruikt met Anthropic (Claude), OpenAI (GPT), Google (Gemini), of zelfs lokale modellen. Naarmate modellen evolueren, zullen de verschillen tussen hen kleiner worden en zullen de prijzen dalen, dus is het belangrijk om provider-agnostisch te zijn.
- Out-of-the-box LSP support
- Kant-en-klare LSP-ondersteuning
- A focus on TUI. OpenCode is built by neovim users and the creators of [terminal.shop](https://terminal.shop); we are going to push the limits of what's possible in the terminal.
- Een focus op TUI (Terminal UI). OpenCode is door Neovim gebruikers en de makers van [terminal.shop](https://terminal.shop) gemaakt; we blijven de limieten van wat er in de terminal mogelijk is pushen.
- Een client/server architectuur. Dit kan bijvoorbeeld OpenCode toestaan op uw computer te draaien terwijl u het vanop afstand bestuurt met een mobiele app, betekent dat de TUI frontend slechts een van de mogelijke clients is.

---

**Sluit je aan bij onze** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
