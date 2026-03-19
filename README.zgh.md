<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logo">
    </picture>
  </a>
</p>
<p align="center">Amswuri n tussna tussnilsant iṛeẓmen (Open Source AI).</p>
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
  <a href="README.zgh.md">Tamazight</a>
</p>

[![OpenCode Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://opencode.ai)

---

### Asers

```bash
# YOLO
curl -fsSL [https://opencode.ai/install](https://opencode.ai/install) | bash

# Imsegduden n tenfulin
npm i -g opencode-ai@latest         # neɣ bun/pnpm/yarn
scoop install opencode               # Windows
choco install opencode               # Windows
brew install anomalyco/tap/opencode # macOS d Linux (yifuy, d amaynut)
brew install opencode               # macOS d Linux (Official brew)
sudo pacman -S opencode             # Arch Linux (Stable)
paru -S opencode-bin                # Arch Linux (Latest AUR)
mise use -g opencode                # Ayen yella unagraw
nix run nixpkgs#opencode            # neɣ github:anomalyco/opencode
````

> [\!TIP]
> Kkes tifersiyin tiqbura n 0.1.x qbel asers.

### Asferar n uselkim (BETA)

OpenCode yella daɣen d asferar n uselkim. Agem-it seg [tasebt n ufsar](https://github.com/anomalyco/opencode/releases) neɣ [opencode.ai/download](https://opencode.ai/download).

| Tagrawt               | Agam                                  |
| --------------------- | ------------------------------------- |
| macOS (Apple Silicon) | `opencode-desktop-darwin-aarch64.dmg` |
| macOS (Intel)         | `opencode-desktop-darwin-x64.dmg`     |
| Windows               | `opencode-desktop-windows-x64.exe`    |
| Linux                 | `.deb`, `.rpm`, neɣ AppImage           |

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/opencode-desktop
```

#### Amanar n users

Askribt n users iweqqer anfulu-agi:

1.  `$OPENCODE_INSTALL_DIR` - Amanar iṣebɣen
2.  `$XDG_BIN_DIR` - Amanar XDG
3.  `$HOME/bin` - Amanar n umssekti (igella)
4.  `$HOME/.opencode/bin` - Amanar n usnuri

### Imswuriyen

OpenCode yesɛa sin imswuriyen, tzemred ad ten-tenfal-ed s `Tab`.

  - **build** - Amswuri n usku, izmer ad ixdem kullec.
  - **plan** - Amswuri n tɣuri d usiggel n tenfalit.
      - Ur yezmir ad isnefel ifaylutn.
      - Itter turagt qbel aslekka n inaḍen Bash.

Yella daɣen umswuri **general** i usiggel d tewuriwin tixatarin (`@general`).

Issin ugar ɣef [imswuriyen](https://opencode.ai/docs/agents).

### Tutrawt

I wuggar n umlan ɣef wamek ara tesseɣtiḍ OpenCode, [**rzu tutrawt nneɣ**](https://opencode.ai/docs).

### Tiwisi

Ig tebɣid ad tawsed deg OpenCode, ɣer [tutrawt n tiwisi](https://www.google.com/search?q=./CONTRIBUTING.md) qbel ad d-tazneḍ turaɡt n usnifel (pull request).

### Asku ɣef OpenCode

Ig t-qedced ɣef usenfar i seqqnen ɣer OpenCode yerna tesseqdceḍ isem "opencode" deg-s (am "opencode-dashboard"), ttxil-wat rnum tasefsert deg README nwen belli mačči d tarbaɛt n OpenCode i t-yebnan yerna ur icudd ara ɣer-neɣ.

### Isteqsiyen (FAQ)

#### Amek i yemxallaf d Claude Code?

OpenCode irwas Claude Code deg tezmert, maca:

  - Ig-a 100% d usfsr iṛeẓmen (Open Source).
  - Ur yeqqin ara d yiwet n tkebbanit. Iswuray d Claude, OpenAI, Google, neɣ imudilen n uselkim (local).
  - Annay n LSP s usnuri (Out-of-the-box).
  - Azdduy n TUI. OpenCode t-bnan imseqdacen n neovim; nebɣa ad nessiweḍ tilas n wayen yezmer ad yili deg udiwnni n terminal.
  - Tamuskiwt n Client/Server. Ayagi isureg i OpenCode ad yeddu deg uselkim-ik ma t-nhereḍ seg tasyant n ufus (mobile).

-----

**Addu ɣer tmezdegt nneɣ** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
