<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logotip">
    </picture>
  </a>
</p>
<p align="center">Odprtokodni AI agent za programiranje.</p>
<p align="center">
  <a href="https://opencode.ai/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/opencode-ai"><img alt="npm" src="https://img.shields.io/npm/v/opencode-ai?style=flat-square" /></a>
  <a href="https://github.com/anomalyco/opencode/actions/workflows/publish.yml"><img alt="Status gradnje" src="https://img.shields.io/github/actions/workflow/status/anomalyco/opencode/publish.yml?style=flat-square&branch=dev" /></a>
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
  <a href="README.sl.md">Slovenščina</a>
</p>

[![OpenCode terminalski vmesnik](packages/web/src/assets/lander/screenshot.png)](https://opencode.ai)

---

### Namestitev

```bash
# YOLO
curl -fsSL https://opencode.ai/install | bash

# Upravljalniki paketov
npm i -g opencode-ai@latest        # ali bun/pnpm/yarn
scoop install opencode             # Windows
choco install opencode             # Windows
brew install anomalyco/tap/opencode # macOS in Linux (priporočeno, vedno posodobljeno)
brew install opencode              # macOS in Linux (uradna brew formula, redkeje posodobljena)
paru -S opencode-bin               # Arch Linux
mise use -g opencode               # Katerikoli OS
nix run nixpkgs#opencode           # ali github:anomalyco/opencode za najnovejšo dev vejo
```

> [!TIP]
> Pred namestitvijo odstranite verzije starejše od 0.1.x.

### Namizna aplikacija (BETA)

OpenCode je na voljo tudi kot namizna aplikacija. Prenesite jo neposredno s [strani z izdajami](https://github.com/anomalyco/opencode/releases) ali z [opencode.ai/download](https://opencode.ai/download).

| Platforma             | Prenos                                |
| --------------------- | ------------------------------------- |
| macOS (Apple Silicon) | `opencode-desktop-darwin-aarch64.dmg` |
| macOS (Intel)         | `opencode-desktop-darwin-x64.dmg`     |
| Windows               | `opencode-desktop-windows-x64.exe`    |
| Linux                 | `.deb`, `.rpm` ali AppImage           |

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/opencode-desktop
```

#### Namestitveni imenik

Namestitvena skripta upošteva naslednji prednostni vrstni red za pot namestitve:

1. `$OPENCODE_INSTALL_DIR` – Prilagojen namestitveni imenik
2. `$XDG_BIN_DIR` – Pot, skladna s specifikacijo XDG Base Directory
3. `$HOME/bin` – Standardni uporabniški imenik za binarne datoteke (če obstaja ali ga je mogoče ustvariti)
4. `$HOME/.opencode/bin` – Privzeta nadomestna pot

```bash
# Primeri
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### Agenti

OpenCode vključuje dva vgrajena agenta, med katerima lahko preklapljate s tipko `Tab`.

- **build** – Privzeti agent s polnim dostopom za razvojno delo
- **plan** – Agent samo za branje, namenjen analizi in raziskovanju kode
  - Privzeto zavrne urejanje datotek
  - Pred izvajanjem bash ukazov zahteva dovoljenje
  - Idealen za raziskovanje neznanih kodnih baz ali načrtovanje sprememb

Vključen je tudi podagent **general** za zahtevna iskanja in večkoračne naloge.
Uporablja se interno in ga je mogoče priklicati z `@general` v sporočilih.

Več o [agentih](https://opencode.ai/docs/agents).

### Dokumentacija

Za več informacij o nastavitvi OpenCode [**obiščite našo dokumentacijo**](https://opencode.ai/docs).

### Prispevanje

Če želite prispevati k OpenCode, pred oddajo zahtevka za združitev preberite naša [navodila za prispevanje](./CONTRIBUTING.md).

### Gradnja na OpenCode

Če delate na projektu, ki je povezan z OpenCode in v imenu uporablja "opencode" (na primer "opencode-dashboard" ali "opencode-mobile"), prosimo dodajte opombo v svoj README, da projekt ni zgrajen s strani ekipe OpenCode in ni z nami na noben način povezan.

### Pogosta vprašanja

#### Kako se to razlikuje od Claude Code?

Po zmogljivostih je zelo podoben Claude Code. Tukaj so ključne razlike:

- 100 % odprtokoden
- Ni vezan na nobenega ponudnika. Čeprav priporočamo modele, ki jih ponujamo prek [OpenCode Zen](https://opencode.ai/zen), lahko OpenCode uporabljate s Claude, OpenAI, Google ali celo lokalnimi modeli. Ko se modeli razvijajo, se bodo razlike med njimi zmanjšale in cene padle, zato je neodvisnost od ponudnika pomembna.
- Vgrajena podpora za LSP
- Poudarek na TUI. OpenCode so zgradili uporabniki neovm-a in ustvarjalci [terminal.shop](https://terminal.shop); nameravamo premikati meje mogočega v terminalu.
- Arhitektura odjemalec/strežnik. To na primer omogoča, da OpenCode teče na vašem računalniku, medtem ko ga upravljate na daljavo iz mobilne aplikacije. To pomeni, da je TUI vmesnik le eden od možnih odjemalcev.

---

**Pridružite se naši skupnosti** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
