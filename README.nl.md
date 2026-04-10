<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logo">
    </picture>
  </a>
</p>
<p align="center">The open source AI coding agent.</p>
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

### Installatie

```bash
# YOLO
curl -fsSL https://opencode.ai/install | bash

# Pakketbeheerders
npm i -g opencode-ai@latest # of bun/pnpm/yarn
scoop install opencode # Windows
choco install opencode # Windows
brew install anomalyco/tap/opencode # macOS en Linux (aanbevolen, altijd up-to-date)
brew install opencode # macOS en Linux (officiële brew-formule, minder vaak bijgewerkt)
sudo pacman -S opencode # Arch Linux (stabiel)
paru -S opencode-bin # Arch Linux (nieuwste versie uit AUR)
mise use -g opencode # Elk besturingssysteem
nix run nixpkgs#opencode # of github:anomalyco/opencode voor de nieuwste ontwikkelingsbranch
```

> [!TIP]
> Verwijder versies ouder dan 0.1.x vóór de installatie.

### Desktop-app (BETA)

OpenCode is ook beschikbaar als desktop applicatie. Download deze direct van de [releasespagina](https://github.com/anomalyco/opencode/releases) of [opencode.ai/download](https://opencode.ai/download).

| Platform | Download |

| --------------------- | ------------------------------------- |

| macOS (Apple Silicon) | `opencode-desktop-darwin-aarch64.dmg` |

| macOS (Intel) | `opencode-desktop-darwin-x64.dmg` |

| Windows | `opencode-desktop-windows-x64.exe` |

| Linux | `.deb`, `.rpm` of AppImage |

``bash
# macOS (Homebrew)
brew install --cask opencode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/opencode-desktop
```

#### Installatiemap

Voor het installatiepad volgt het installatiescript deze volgorde in alopende prioriteit:

1. `$OPENCODE_INSTALL_DIR` - Aangepaste installatiemap
2. `$XDG_BIN_DIR` - Pad conform de XDG Base Directory Specification
3. `$HOME/bin` - Standaard gebruikersmap voor binaire bestanden (indien deze bestaat of kan worden aangemaakt)
4. `$HOME/.opencode/bin` - Standaard terugval-optie

```bash
# Voorbeelden
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### Agents

OpenCode bevat twee ingebouwde agenten ('agents') waartussen u kunt schakelen met de `Tab`-toets.

- **build** - Standaard agent met volledige toegang voor ontwikkelwerk
- **plan** - Alleen-lezen agent voor analyse en codeverkenning

- Bestandsbewerkingen zijn standaard geblokkeerd

- Vraagt ​​toestemming voordat bash-opdrachten worden uitgevoerd

- Ideaal voor het verkennen van onbekende codebases of het plannen van wijzigingen

Er is ook een **algemene** subagent beschikbaar voor complexe zoekopdrachten en taken met meerdere stappen.

Deze wordt intern gebruikt en kan worden aangeroepen met `@general` in berichten.

Lees meer over [agents](https://opencode.ai/docs/agents).

### Documentatie

[**Ga naar onze documentatie**](https://opencode.ai/docs) voor meer informatie over het configureren van OpenCode.

### Bijdragen

Als u wilt bijdragen aan OpenCode, lees dan onze [documentatie over bijdragen](./CONTRIBUTING.md) voordat u een pull request indient.

### Voortbouwen op OpenCode

Als u werkt aan een project dat gerelateerd is aan OpenCode en "opencode" in de naam gebruikt, bijvoorbeeld "opencode-dashboard" of "opencode-mobile", voeg dan een opmerking toe aan uw README om te verduidelijken dat het niet door het OpenCode-team is ontwikkeld en op geen enkele manier aan ons is gelieerd.

### Veelgestelde vragen

#### Wat is het verschil met Claude Code?

Qua functionaliteit is het erg vergelijkbaar met Claude Code. Dit zijn de belangrijkste verschillen:

- 100% open source
- Niet gekoppeld aan een specifieke provider. Hoewel we de modellen aanbevelen die we via [OpenCode Zen](https://opencode.ai/zen) aanbieden, kan OpenCode ook worden gebruikt met Claude, OpenAI, Google of zelfs lokale modellen. Naarmate modellen zich ontwikkelen zullen de verschillen kleiner worden en de prijzen dalen, dus het is belangrijk om provider-agnostisch te zijn.
- Direct beschikbare LSP-ondersteuning
- Focus op TUI. OpenCode is ontwikkeld door Neovim-gebruikers en de makers van [terminal.shop](https://terminal.shop); we gaan de grenzen verleggen van wat mogelijk is in de terminal.
- Een client/server-architectuur. Dit maakt het bijvoorbeeld mogelijk dat OpenCode op je computer draait terwijl je het op afstand bestuurt via een mobiele app. De TUI-frontend is dan slechts één van de mogelijke clients.

---

**Word lid van onze community** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)