<p align="center">
  <a href="https://lotioncode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="LotionCode logo">
    </picture>
  </a>
</p>
<p align="center">Den open source AI-kodeagent.</p>
<p align="center">
  <a href="https://lotioncode.ai/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/lotioncode-ai"><img alt="npm" src="https://img.shields.io/npm/v/lotioncode-ai?style=flat-square" /></a>
  <a href="https://github.com/anomalyco/lotioncode/actions/workflows/publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/anomalyco/lotioncode/publish.yml?style=flat-square&branch=dev" /></a>
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
  <a href="README.ar.md">العربية</a> |
  <a href="README.no.md">Norsk</a> |
  <a href="README.br.md">Português (Brasil)</a> |
  <a href="README.th.md">ไทย</a> |
  <a href="README.tr.md">Türkçe</a>
</p>

[![LotionCode Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://lotioncode.ai)

---

### Installation

```bash
# YOLO
curl -fsSL https://lotioncode.ai/install | bash

# Pakkehåndteringer
npm i -g lotioncode-ai@latest        # eller bun/pnpm/yarn
scoop install lotioncode             # Windows
choco install lotioncode             # Windows
brew install anomalyco/tap/lotioncode # macOS og Linux (anbefalet, altid up to date)
brew install lotioncode              # macOS og Linux (officiel brew formula, opdateres sjældnere)
paru -S lotioncode-bin               # Arch Linux
mise use -g lotioncode               # alle OS
nix run nixpkgs#lotioncode           # eller github:anomalyco/lotioncode for nyeste dev-branch
```

> [!TIP]
> Fjern versioner ældre end 0.1.x før installation.

### Desktop-app (BETA)

LotionCode findes også som desktop-app. Download direkte fra [releases-siden](https://github.com/anomalyco/lotioncode/releases) eller [lotioncode.ai/download](https://lotioncode.ai/download).

| Platform              | Download                              |
| --------------------- | ------------------------------------- |
| macOS (Apple Silicon) | `lotioncode-desktop-darwin-aarch64.dmg` |
| macOS (Intel)         | `lotioncode-desktop-darwin-x64.dmg`     |
| Windows               | `lotioncode-desktop-windows-x64.exe`    |
| Linux                 | `.deb`, `.rpm`, eller AppImage        |

```bash
# macOS (Homebrew)
brew install --cask lotioncode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/lotioncode-desktop
```

#### Installationsmappe

Installationsscriptet bruger følgende prioriteringsrækkefølge for installationsstien:

1. `$LOTIONCODE_INSTALL_DIR` - Tilpasset installationsmappe
2. `$XDG_BIN_DIR` - Sti der følger XDG Base Directory Specification
3. `$HOME/bin` - Standard bruger-bin-mappe (hvis den findes eller kan oprettes)
4. `$HOME/.lotioncode/bin` - Standard fallback

```bash
# Eksempler
LOTIONCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://lotioncode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://lotioncode.ai/install | bash
```

### Agents

LotionCode har to indbyggede agents, som du kan skifte mellem med `Tab`-tasten.

- **build** - Standard, agent med fuld adgang til udviklingsarbejde
- **plan** - Skrivebeskyttet agent til analyse og kodeudforskning
  - Afviser filredigering som standard
  - Spørger om tilladelse før bash-kommandoer
  - Ideel til at udforske ukendte kodebaser eller planlægge ændringer

Derudover findes der en **general**-subagent til komplekse søgninger og flertrinsopgaver.
Den bruges internt og kan kaldes via `@general` i beskeder.

Læs mere om [agents](https://lotioncode.ai/docs/agents).

### Dokumentation

For mere info om konfiguration af LotionCode, [**se vores docs**](https://lotioncode.ai/docs).

### Bidrag

Hvis du vil bidrage til LotionCode, så læs vores [contributing docs](./CONTRIBUTING.md) før du sender en pull request.

### Bygget på LotionCode

Hvis du arbejder på et projekt der er relateret til LotionCode og bruger "lotioncode" som en del af navnet; f.eks. "lotioncode-dashboard" eller "lotioncode-mobile", så tilføj en note i din README, der tydeliggør at projektet ikke er bygget af LotionCode-teamet og ikke er tilknyttet os på nogen måde.

### FAQ

#### Hvordan adskiller dette sig fra Claude Code?

Det minder meget om Claude Code i forhold til funktionalitet. Her er de vigtigste forskelle:

- 100% open source
- Ikke låst til en udbyder. Selvom vi anbefaler modellerne via [LotionCode Zen](https://lotioncode.ai/zen); kan LotionCode bruges med Claude, OpenAI, Google eller endda lokale modeller. Efterhånden som modeller udvikler sig vil forskellene mindskes og priserne falde, så det er vigtigt at være provider-agnostic.
- LSP-support out of the box
- Fokus på TUI. LotionCode er bygget af neovim-brugere og skaberne af [terminal.shop](https://terminal.shop); vi vil skubbe grænserne for hvad der er muligt i terminalen.
- Klient/server-arkitektur. Det kan f.eks. lade LotionCode køre på din computer, mens du styrer den eksternt fra en mobilapp. Det betyder at TUI-frontend'en kun er en af de mulige clients.

---

**Bliv en del af vores community** [Discord](https://discord.gg/lotioncode) | [X.com](https://x.com/lotioncode)
