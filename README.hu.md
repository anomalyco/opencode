<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logó">
    </picture>
  </a>
</p>
<p align="center">A nyílt forráskódú AI kódolási ügynök.</p>
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
  <a href="README.hu.md">Magyar</a> |
  <a href="README.da.md">Dansk</a> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.pl.md">Polski</a> |
  <a href="README.ru.md">Русский</a> |
  <a href="README.ar.md">العربية</a> |
  <a href="README.no.md">Norsk</a> |
  <a href="README.br.md">Português (Brasil)</a> |
  <a href="README.th.md">ไทย</a>
</p>

[![OpenCode Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://opencode.ai)

---

### Telepítés

```bash
# YOLO
curl -fsSL https://opencode.ai/install | bash

# Csomagkezelők
npm i -g opencode-ai@latest        # vagy bun/pnpm/yarn
scoop install opencode             # Windows
choco install opencode             # Windows
brew install anomalyco/tap/opencode # macOS és Linux (ajánlott, mindig naprakész)
brew install opencode              # macOS és Linux (hivatalos brew csomag, ritkábban frissül)
paru -S opencode-bin               # Arch Linux
mise use -g opencode               # Bármely OS
nix run nixpkgs#opencode           # vagy github:anomalyco/opencode a legfrissebb dev branchhez
```

> [!TIP]
> Távolítsd el a 0.1.x-nél régebbi verziókat a telepítés előtt.

### Asztali alkalmazás (BETA)

Az OpenCode asztali alkalmazásként is elérhető. Közvetlenül letöltheted a [releases oldalról](https://github.com/anomalyco/opencode/releases) vagy az [opencode.ai/download](https://opencode.ai/download) weboldalról.

| Platform              | Letöltés                              |
| --------------------- | ------------------------------------- |
| macOS (Apple Silicon) | `opencode-desktop-darwin-aarch64.dmg` |
| macOS (Intel)         | `opencode-desktop-darwin-x64.dmg`     |
| Windows               | `opencode-desktop-windows-x64.exe`    |
| Linux                 | `.deb`, `.rpm`, vagy AppImage         |

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/opencode-desktop
```

#### Telepítési könyvtár

A telepítő szkript az alábbi prioritási sorrendet követi a telepítési útvonal meghatározásakor:

1. `$OPENCODE_INSTALL_DIR` – Egyéni telepítési könyvtár
2. `$XDG_BIN_DIR` – XDG Base Directory Specification-nak megfelelő útvonal
3. `$HOME/bin` – Standard felhasználói bináris könyvtár (ha létezik vagy létrehozható)
4. `$HOME/.opencode/bin` – Alapértelmezett fallback

```bash
# Példák
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### Ágensek

Az OpenCode két beépített ügynököt tartalmaz, amik között a `Tab` billentyűvel válthatsz.

- **build** – Alapértelmezett, teljes hozzáférésű ügynök, fejlesztési munkához
- **plan** – Csak olvasási jogú ügynök, elemzéshez és kódfelderítéshez
  - Alapértelmezetten megtagadja a fájlmódosításokat
  - Engedélyt kér bash parancsok futtatása előtt
  - Ideális ismeretlen kódbázisok felfedezéséhez vagy változtatások tervezéséhez

Tartalmaz egy **general** ügynököt is összetett keresésekhez és többlépéses feladatokhoz.
Ez belsőleg használatos, és az üzenetekben `@general` használatával hívható meg.

További információ az [ügynökökről](https://opencode.ai/docs/agents).

### Dokumentáció

Az OpenCode konfigurálásáról további információkért [**nézzd meg a dokumentációt**](https://opencode.ai/docs).

### Közreműködés

Ha szeretnél közreműködni az OpenCode fejlesztésében, kérlek olvasd el a [közreműködési útmutatónkat](./CONTRIBUTING.md) mielőtt pull requestet küldesz.

### Építkezés az OpenCode-ra

Ha olyan projekten dolgozol, ami az OpenCode-hoz kapcsolódik és az "opencode" nevet használja a nevében (például "opencode-dashboard" vagy "opencode-mobile"), kérlek adj hozzá egy megjegyzést a README-dhez, amely tisztázza, hogy nem az OpenCode csapat készítette és semmilyen módon nem kapcsolódik hozzánk.

### GYIK

#### Miben különbözik a Claude Code-tól?

Képességeit tekintve nagyon hasonlít a Claude Code-hoz. Íme a főbb különbségek:

- 100% nyílt forráskódú
- Nem kötődik egyetlen szolgáltatóhoz sem. Bár az [OpenCode Zen](https://opencode.ai/zen) által biztosított modelleket ajánljuk, az OpenCode használható Claude-dal, OpenAI-jal, Google-lel vagy akár helyi modellekkel is. Ahogy a modellek fejlődnek, a köztük lévő különbségek csökkenni fognak és az árak esni fognak, ezért fontos a szolgáltatófüggetlenség.
- Beépített LSP támogatás
- A TUI-ra való fókusz. Az OpenCode-ot neovim felhasználók és a [terminal.shop](https://terminal.shop) készítői fejlesztik; a terminálban elérhető lehetőségek határait fogjuk feszegetni.
- Kliens/szerver architektúra. Ez például lehetővé teszi, hogy az OpenCode a számítógépeden fusson, miközben távolról irányíthatod egy mobilalkalmazásból. Ez azt jelenti, hogy a TUI frontend csak az egyik lehetséges kliens.

---

**Csatlakozz a közösségünkhöz** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
