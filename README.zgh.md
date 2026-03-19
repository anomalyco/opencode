\<p align="center"\>
\<a href="[https://opencode.ai](https://opencode.ai)"\>
\<picture\>
\<source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)"\>
\<source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)"\>
\<img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logo"\>
\</picture\>
\</a\>
\</p\>
\<p align="center"\>Amswuri n tussna tussnilsant iṛeẓmen (Open Source AI).\</p\>

\<p align="center"\>
\<a href="[https://opencode.ai/discord](https://opencode.ai/discord)"\>\<img alt="Discord" src="[https://img.shields.io/discord/1391832426048651334?style=flat-square\&label=discord](https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord)" /\>\</a\>
\<a href="[https://www.npmjs.com/package/opencode-ai](https://www.npmjs.com/package/opencode-ai)"\>\<img alt="npm" src="[https://img.shields.io/npm/v/opencode-ai?style=flat-square](https://img.shields.io/npm/v/opencode-ai?style=flat-square)" /\>\</a\>
\<a href="[https://github.com/anomalyco/opencode/actions/workflows/publish.yml](https://github.com/anomalyco/opencode/actions/workflows/publish.yml)"\>\<img alt="Build status" src="[https://img.shields.io/github/actions/workflow/status/anomalyco/opencode/publish.yml?style=flat-square\&branch=dev](https://img.shields.io/github/actions/workflow/status/anomalyco/opencode/publish.yml?style=flat-square&branch=dev)" /\>\</a\>
\</p\>

-----

### Asers (Installation)

```bash
# YOLO
curl -fsSL https://opencode.ai/install | bash

# Imsegduden n tenfulin (Package managers)
npm i -g opencode-ai@latest         # neɣ bun/pnpm/yarn
scoop install opencode               # Windows
choco install opencode               # Windows
brew install anomalyco/tap/opencode # macOS d Linux (yifuy, d amaynut)
brew install opencode               # macOS d Linux (Official brew)
sudo pacman -S opencode             # Arch Linux (Stable)
paru -S opencode-bin                # Arch Linux (Latest AUR)
mise use -g opencode                # Ayen yella unagraw
nix run nixpkgs#opencode            # neɣ github:anomalyco/opencode
```

> [\!TIP]
> Kkes tifersiyin tiqbura n 0.1.x qbel asers.

### Asferar n uselkim (Desktop App - BETA)

OpenCode yella daɣen d asferar n uselkim. Agem-it seg [tasebt n ufsar](https://github.com/anomalyco/opencode/releases) neɣ [opencode.ai/download](https://opencode.ai/download).

| Tagrawt (Platform)    | Agam (Download)                       |
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

#### Amanar n users (Installation Directory)

Askribt n users iweqqer anfulu-agi:

1.  `$OPENCODE_INSTALL_DIR` - Amanar iṣebɣen
2.  `$XDG_BIN_DIR` - Amanar XDG
3.  `$HOME/bin` - Amanar n umssekti (igella)
4.  `$HOME/.opencode/bin` - Amanar n usnuri

### Imswuriye n (Agents)

OpenCode yesɛa sin imswuriyen, tzemred ad ten-tenfal-ed s `Tab`.

  - **build** - Amswuri n usku, izmer ad ixdem kullec.
  - **plan** - Amswuri n tɣuri d usiggel n tenfalit.
      - Ur yezmir ad isnefel ifaylutn.
      - Itter turagt qbel aslekka n inaḍen Bash.
  - **general** - Amswuri n usiggel d tewuriwin tixatarin (`@general`).

### Tutrawt (Documentation)

I wuggar n umlan, [**rzu tutrawt nneɣ**](https://opencode.ai/docs).

### Tiwisi (Contributing)

Ig tebɣid ad tawsed, ɣer [tutrawt n tiwisi](https://www.google.com/search?q=./CONTRIBUTING.md).

### FAQ (Isteqsiyen)

#### Amek i yemxallaf d Claude Code?

OpenCode irwas Claude Code, maca:

  - Ig-a 100% d usfsr iṛeẓmen (Open Source).
  - Ur yeqqin ara d yiwet n tkebbanit. Iswuray d Claude, OpenAI, Google, neɣ imudilen n uselkim (local).
  - Annay n LSP s usnuri.
  - Azdduy n TUI (Terminal).
  - Tamuskiwt n Client/Server.

-----

**Addu ɣer tmezdegt nneɣ** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
