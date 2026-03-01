<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="Logoja OpenCode">
    </picture>
  </a>
</p>
<p align="center">Agjenti open source i kodimit me AI.</p>
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
  <a href="README.sq.md">Shqip</a> |
  <a href="README.uk.md">Українська</a> |
  <a href="README.bn.md">বাংলা</a> |
  <a href="README.gr.md">Ελληνικά</a>
</p>

[![OpenCode Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://opencode.ai)

---

### Instalimi

```bash
# YOLO
curl -fsSL https://opencode.ai/install | bash

# Menaxherë paketash
npm i -g opencode-ai@latest        # ose bun/pnpm/yarn
scoop install opencode             # Windows
choco install opencode             # Windows
brew install anomalyco/tap/opencode # macOS dhe Linux (rekomandohet, gjithmonë i përditësuar)
brew install opencode              # macOS dhe Linux (formula zyrtare brew, përditësohet më rrallë)
sudo pacman -S opencode            # Arch Linux (Stable)
paru -S opencode-bin               # Arch Linux (Latest from AUR)
mise use -g opencode               # Çdo OS
nix run nixpkgs#opencode           # ose github:anomalyco/opencode për degën më të fundit dev
```

> [!TIP]
> Hiq versionet më të vjetra se 0.1.x para instalimit.

### Aplikacioni Desktop (BETA)

OpenCode është i disponueshëm edhe si aplikacion desktop. Shkarkoje direkt nga [faqja e release-ve](https://github.com/anomalyco/opencode/releases) ose nga [opencode.ai/download](https://opencode.ai/download).

| Platforma             | Shkarkimi                             |
| --------------------- | ------------------------------------- |
| macOS (Apple Silicon) | `opencode-desktop-darwin-aarch64.dmg` |
| macOS (Intel)         | `opencode-desktop-darwin-x64.dmg`     |
| Windows               | `opencode-desktop-windows-x64.exe`    |
| Linux                 | `.deb`, `.rpm`, ose AppImage          |

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/opencode-desktop
```

#### Direktoria e instalimit

Skripti i instalimit respekton këtë rend prioriteti për rrugën e instalimit:

1. `$OPENCODE_INSTALL_DIR` - Direktor i personalizuar instalimi
2. `$XDG_BIN_DIR` - Rrugë në përputhje me XDG Base Directory Specification
3. `$HOME/bin` - Direktori standard i binareve të përdoruesit (nëse ekziston ose mund të krijohet)
4. `$HOME/.opencode/bin` - Opsioni i parazgjedhur rezervë

```bash
# Shembuj
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### Agjentët

OpenCode përfshin dy agjentë të integruar, mes të cilëve mund të kalosh me tastin `Tab`.

- **build** - I parazgjedhur, agjent me akses të plotë për punë zhvillimi
- **plan** - Agjent vetëm për lexim për analizë dhe eksplorim të kodit
  - Ndalon modifikimet e skedarëve si parazgjedhje
  - Kërkon leje para ekzekutimit të komandave bash
  - Ideal për të eksploruar codebase të panjohura ose për të planifikuar ndryshime

Gjithashtu përfshihet edhe një nën-agjent **general** për kërkime komplekse dhe detyra me shumë hapa.
Ky përdoret brenda sistemit dhe mund të thirret me `@general` në mesazhe.

Mëso më shumë rreth [agjentëve](https://opencode.ai/docs/agents).

### Dokumentacioni

Për më shumë informacion rreth konfigurimit të OpenCode, [**shiko dokumentacionin tonë**](https://opencode.ai/docs).

### Kontributi

Nëse je i interesuar të kontribuosh në OpenCode, lexo [udhëzuesin e kontributit](./CONTRIBUTING.md) përpara se të dërgosh një pull request.

### Ndërtimi mbi OpenCode

Nëse po punon në një projekt të lidhur me OpenCode dhe që përdor "opencode" si pjesë të emrit, për shembull "opencode-dashboard" ose "opencode-mobile", shto një shënim në README-n tënd për të qartësuar se nuk është ndërtuar nga ekipi OpenCode dhe nuk është i lidhur me ne në asnjë mënyrë.

### FAQ

#### Si ndryshon ky nga Claude Code?

Për sa i përket aftësive, është shumë i ngjashëm me Claude Code. Këto janë dallimet kryesore:

- 100% open source
- Nuk është i lidhur me një ofrues të vetëm. Edhe pse ne rekomandojmë modelet që ofrojmë përmes [OpenCode Zen](https://opencode.ai/zen), OpenCode mund të përdoret me Claude, OpenAI, Google, ose edhe me modele lokale. Me evoluimin e modeleve, diferencat mes tyre do të zvogëlohen dhe çmimet do të bien, prandaj është e rëndësishme të jesh agnostik ndaj ofruesit.
- Mbështetje LSP menjëherë pas instalimit
- Fokus te TUI. OpenCode ndërtohet nga përdorues të neovim dhe krijuesit e [terminal.shop](https://terminal.shop); ne do të shtyjmë kufijtë e asaj që është e mundur në terminal.
- Arkitekturë klient/server. Kjo, për shembull, mundëson që OpenCode të ekzekutohet në kompjuterin tënd ndërsa e kontrollon nga larg përmes një aplikacioni mobil, që do të thotë se frontend-i TUI është vetëm një nga klientët e mundshëm.

---

**Bashkohu me komunitetin tonë** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
