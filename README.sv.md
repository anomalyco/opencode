<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode-logotyp">
    </picture>
  </a>
</p>
<p align="center">Den öppna AI-kodagenten.</p>
<p align="center">
  <a href="https://opencode.ai/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/opencode-ai"><img alt="npm" src="https://img.shields.io/npm/v/opencode-ai?style=flat-square" /></a>
  <a href="https://github.com/anomalyco/opencode/actions/workflows/publish.yml"><img alt="Byggstatus" src="https://img.shields.io/github/actions/workflow/status/anomalyco/opencode/publish.yml?style=flat-square&branch=dev" /></a>
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
  <a href="README.sv.md">Svenska</a> |
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

# Pakethanterare
npm i -g opencode-ai@latest        # eller bun/pnpm/yarn
scoop install opencode             # Windows
choco install opencode             # Windows
brew install anomalyco/tap/opencode # macOS och Linux (rekommenderas, alltid uppdaterad)
brew install opencode              # macOS och Linux (officiellt Homebrew-recept, uppdateras mer sällan)
sudo pacman -S opencode            # Arch Linux (Stable)
paru -S opencode-bin               # Arch Linux (Latest from AUR)
mise use -g opencode               # alla operativsystem
nix run nixpkgs#opencode           # eller github:anomalyco/opencode för senaste dev-grenen
```

> [!TIP]
> Ta bort versioner äldre än 0.1.x innan du installerar.

### Desktop-appen (BETA)

OpenCode finns även som desktop-app. Ladda ner den från [releasesidan](https://github.com/anomalyco/opencode/releases) eller [opencode.ai/download](https://opencode.ai/download).

| Plattform              | Nedladdning                       |
| ---------------------- | --------------------------------- |
| macOS (Apple Silicon)  | `opencode-desktop-mac-arm64.dmg`  |
| macOS (Intel)          | `opencode-desktop-mac-x64.dmg`   |
| Windows                | `opencode-desktop-windows-x64.exe`|
| Linux                  | `.deb`, `.rpm` eller `.AppImage`  |

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/opencode-desktop
```

#### Installationsmapp

Installationsskriptet använder följande prioriteringsordning för installationssökvägen:

1. `$OPENCODE_INSTALL_DIR` – Anpassad installationsmapp
2. `$XDG_BIN_DIR` – Sökväg enligt XDG Base Directory Specification
3. `$HOME/bin` – Standardmapp för användarbinärfiler (om den finns eller kan skapas)
4. `$HOME/.opencode/bin` – Standardreserv

```bash
# Exempel
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### Agenter

OpenCode har två inbyggda agenter som du kan växla mellan med tangenten `Tab`.

- **build** – Standardagent med full åtkomst för utvecklingsarbete
- **plan** – Skrivskyddad agent för analys och kodutforskning
  - nekar filändringar som standard
  - frågar efter tillåtelse före Bash-kommandon
  - passar bra för att utforska okända kodbaser eller planera ändringar

Det finns också en **general**-underagent för komplexa sökningar och uppgifter i flera steg. Den används internt och kan anropas med `@general` i meddelanden.

Läs mer om [agenter](https://opencode.ai/docs/agents).

### Dokumentation

Mer information om hur OpenCode konfigureras finns i [**dokumentationen**](https://opencode.ai/docs).

### Bidra

Om du vill bidra till OpenCode ska du läsa [bidragsdokumentationen](./CONTRIBUTING.md) innan du skickar en pull request.

### Bygga vidare på OpenCode

Om du arbetar med ett projekt som har koppling till OpenCode och använder ”opencode” i namnet, till exempel ”opencode-dashboard” eller ”opencode-mobile”, ska du lägga till en notis i README-filen som tydliggör att projektet inte är byggt av OpenCode-teamet och inte är knutet till oss.

---

**Gå med i gemenskapen:** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
