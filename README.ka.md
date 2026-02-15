<a href="[https://opencode.ai](https://opencode.ai)">
<picture>
<source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
<source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
<img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logo">
</picture>
</a>
</p>
<p align="center">ಓಪನ್ ಸೋರ್ಸ್ AI ಕೋಡಿಂಗ್ ಏಜೆಂಟ್.</p>
<p align="center">
<a href="[https://opencode.ai/discord](https://opencode.ai/discord)"><img alt="Discord" src="[https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord](https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord)" /></a>
<a href="[https://www.npmjs.com/package/opencode-ai](https://www.npmjs.com/package/opencode-ai)"><img alt="npm" src="[https://img.shields.io/npm/v/opencode-ai?style=flat-square](https://img.shields.io/npm/v/opencode-ai?style=flat-square)" /></a>
<a href="[https://github.com/anomalyco/opencode/actions/workflows/publish.yml](https://github.com/anomalyco/opencode/actions/workflows/publish.yml)"><img alt="Build status" src="[https://img.shields.io/github/actions/workflow/status/anomalyco/opencode/publish.yml?style=flat-square&branch=dev](https://img.shields.io/github/actions/workflow/status/anomalyco/opencode/publish.yml?style=flat-square&branch=dev)" /></a>
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
<a href="README.uk.md">Українська</a>
</p>

---

### ಅನುಸ್ಥಾಪನೆ (Installation)

```bash
# YOLO (ನೇರ ಇನ್‌ಸ್ಟಾಲೇಷನ್)
curl -fsSL https://opencode.ai/install | bash

# ಪ್ಯಾಕೇಜ್ ಮ್ಯಾನೇಜರ್‌ಗಳು (Package managers)
npm i -g opencode-ai@latest        # ಅಥವಾ bun/pnpm/yarn
scoop install opencode             # Windows
choco install opencode             # Windows
brew install anomalyco/tap/opencode # macOS ಮತ್ತು Linux (ಶಿಫಾರಸು ಮಾಡಲಾಗಿದೆ, ಯಾವಾಗಲೂ ಅಪ್‌ಡೇಟ್ ಆಗಿರುತ್ತದೆ)
brew install opencode              # macOS ಮತ್ತು Linux (ಅಧಿಕೃತ brew ಫಾರ್ಮುಲಾ, ಕಡಿಮೆ ಬಾರಿ ಅಪ್‌ಡೇಟ್ ಆಗುತ್ತದೆ)
sudo pacman -S opencode            # Arch Linux (Stable)
paru -S opencode-bin               # Arch Linux (AUR ನಿಂದ ಇತ್ತೀಚಿನದು)
mise use -g opencode               # ಯಾವುದೇ OS
nix run nixpkgs#opencode           # ಅಥವಾ ಇತ್ತೀಚಿನ dev ಬ್ರಾಂಚ್‌ಗಾಗಿ github:anomalyco/opencode 

```

> [!TIP]
> ಇನ್‌ಸ್ಟಾಲ್ ಮಾಡುವ ಮೊದಲು 0.1.x ಗಿಂತ ಹಳೆಯ ಆವೃತ್ತಿಗಳನ್ನು (versions) ತೆಗೆದುಹಾಕಿ.

### ಡೆಸ್ಕ್‌ಟಾಪ್ ಆಪ್ (BETA)

OpenCode ಡೆಸ್ಕ್‌ಟಾಪ್ ಅಪ್ಲಿಕೇಶನ್ ಆಗಿಯೂ ಲಭ್ಯವಿದೆ. ನೇರವಾಗಿ [releases page](https://github.com/anomalyco/opencode/releases) ಅಥವಾ [opencode.ai/download](https://opencode.ai/download) ನಿಂದ ಡೌನ್‌ಲೋಡ್ ಮಾಡಿ.

| ಪ್ಲಾಟ್‌ಫಾರ್ಮ್ (Platform) | ಡೌನ್‌ಲೋಡ್ (Download) |
| --- | --- |
| macOS (Apple Silicon) | `opencode-desktop-darwin-aarch64.dmg` |
| macOS (Intel) | `opencode-desktop-darwin-x64.dmg` |
| Windows | `opencode-desktop-windows-x64.exe` |
| Linux | `.deb`, `.rpm`, ಅಥವಾ AppImage |

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop

# Windows (Scoop)
scoop bucket add extras; scoop install extras/opencode-desktop

```

#### ಇನ್‌ಸ್ಟಾಲೇಷನ್ ಡೈರೆಕ್ಟರಿ (Installation Directory)

ಇನ್‌ಸ್ಟಾಲ್ ಸ್ಕ್ರಿಪ್ಟ್ ಅನುಸ್ಥಾಪನಾ ಮಾರ್ಗಕ್ಕಾಗಿ (path) ಈ ಕೆಳಗಿನ ಆದ್ಯತೆಯ ಕ್ರಮವನ್ನು ಪಾಲಿಸುತ್ತದೆ:

1. `$OPENCODE_INSTALL_DIR` - ಕಸ್ಟಮ್ ಇನ್‌ಸ್ಟಾಲೇಷನ್ ಡೈರೆಕ್ಟರಿ
2. `$XDG_BIN_DIR` - XDG ಬೇಸ್ ಡೈರೆಕ್ಟರಿ ಸ್ಪೆಸಿಫಿಕೇಶನ್ ಕಂಪ್ಲೈಂಟ್ ಪಾತ್ (path)
3. `$HOME/bin` - ಸಾಮಾನ್ಯ ಬಳಕೆದಾರ ಬೈನರಿ ಡೈರೆಕ್ಟರಿ (ಇದು ಅಸ್ತಿತ್ವದಲ್ಲಿದ್ದರೆ ಅಥವಾ ರಚಿಸಲು ಸಾಧ್ಯವಾದರೆ)
4. `$HOME/.opencode/bin` - ಡೀಫಾಲ್ಟ್ ಫಾಲ್‌ಬ್ಯಾಕ್

```bash
# ಉದಾಹರಣೆಗಳು
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash

```

### ಏಜೆಂಟ್‌ಗಳು (Agents)

OpenCode ಎರಡು ಬಿಲ್ಟ್-ಇನ್ ಏಜೆಂಟ್‌ಗಳನ್ನು ಒಳಗೊಂಡಿದೆ, ನೀವು `Tab` ಕೀ ಬಳಸುವ ಮೂಲಕ ಇವುಗಳ ನಡುವೆ ಬದಲಾಯಿಸಬಹುದು.

* **build** - ಡೆವಲಪ್‌ಮೆಂಟ್ ಕೆಲಸಕ್ಕಾಗಿ ಡೀಫಾಲ್ಟ್ ಆಗಿರುವ, ಸಂಪೂರ್ಣ ಆಕ್ಸೆಸ್ (full-access) ಉಳ್ಳ ಏಜೆಂಟ್.
* **plan** - ವಿಶ್ಲೇಷಣೆ ಮತ್ತು ಕೋಡ್ ಪರಿಶೀಲನೆಗಾಗಿ 'ರೀಡ್-ಓನ್ಲಿ' (ಓದಲು ಮಾತ್ರ) ಏಜೆಂಟ್.
* ಇದು ಫೈಲ್ ಎಡಿಟ್‌ಗಳನ್ನು ಡೀಫಾಲ್ಟ್ ಆಗಿ ತಡೆಯುತ್ತದೆ.
* bash ಕಮಾಂಡ್‌ಗಳನ್ನು ರನ್ ಮಾಡುವ ಮೊದಲು ಅನುಮತಿ ಕೇಳುತ್ತದೆ.
* ಹೊಸ ಕೋಡ್‌ಬೇಸ್‌ಗಳನ್ನು ಅರಿಯಲು ಅಥವಾ ಬದಲಾವಣೆಗಳನ್ನು ಪ್ಲಾನ್ ಮಾಡಲು ಇದು ಸೂಕ್ತ.



ಇದರ ಜೊತೆಗೆ ಸಂಕೀರ್ಣ ಹುಡುಕಾಟಗಳು ಮತ್ತು ಮಲ್ಟಿ-ಸ್ಟೆಪ್ ಟಾಸ್ಕ್‌ಗಳಿಗಾಗಿ **general** ಸಬ್-ಏಜೆಂಟ್ (subagent) ಕೂಡ ಸೇರಿದೆ.
ಇದನ್ನು ಆಂತರಿಕವಾಗಿ ಬಳಸಲಾಗುತ್ತದೆ ಮತ್ತು ಸಂದೇಶಗಳಲ್ಲಿ `@general` ಎಂದು ಬಳಸುವ ಮೂಲಕ ಇದನ್ನು ಕರೆಯಬಹುದು.

ಏಜೆಂಟ್‌ಗಳ ಬಗ್ಗೆ ಇನ್ನಷ್ಟು ತಿಳಿಯಲು [ಇಲ್ಲಿ ಕ್ಲಿಕ್ ಮಾಡಿ](https://opencode.ai/docs/agents).

### ದಾಖಲೀಕರಣ (Documentation)

OpenCode ಅನ್ನು ಹೇಗೆ ಕಾನ್ಫಿಗರ್ ಮಾಡುವುದು ಎಂಬುದರ ಕುರಿತು ಹೆಚ್ಚಿನ ಮಾಹಿತಿಗಾಗಿ, **[ನಮ್ಮ ಡಾಕ್ಸ್‌ಗೆ (docs) ಭೇಟಿ ನೀಡಿ](https://opencode.ai/docs)**.

### ಯೋಗದಾನ (Contributing)

ನೀವು OpenCode ಗೆ ಕೊಡುಗೆ ನೀಡಲು ಆಸಕ್ತಿ ಹೊಂದಿದ್ದರೆ, ದಯವಿಟ್ಟು ಪುಲ್ ರಿಕ್ವೆಸ್ಟ್ (pull request) ಸಲ್ಲಿಸುವ ಮೊದಲು ನಮ್ಮ [ಕೊಡುಗೆ ನೀಡುವ ಮಾರ್ಗಸೂಚಿಗಳನ್ನು (contributing docs)](https://www.google.com/search?q=./CONTRIBUTING.md) ಓದಿ.

### OpenCode ಆಧಾರಿತ ಅಭಿವೃದ್ಧಿ

ನೀವು OpenCode ಗೆ ಸಂಬಂಧಿಸಿದ ಪ್ರಾಜೆಕ್ಟ್ ಮೇಲೆ ಕೆಲಸ ಮಾಡುತ್ತಿದ್ದರೆ ಮತ್ತು ಹೆಸರಿನಲ್ಲಿ "opencode" (ಉದಾಹರಣೆಗೆ "opencode-dashboard" ಅಥವಾ "opencode-mobile") ಬಳಸುತ್ತಿದ್ದರೆ, ದಯವಿಟ್ಟು ನಿಮ್ಮ README ಫೈಲ್‌ನಲ್ಲಿ ಒಂದು ಟಿಪ್ಪಣಿಯನ್ನು ಸೇರಿಸಿ. ಅದು OpenCode ತಂಡದಿಂದ ನಿರ್ಮಿಸಲಾಗಿಲ್ಲ ಮತ್ತು ನಮ್ಮೊಂದಿಗೆ ಯಾವುದೇ ಸಂಬಂಧ ಹೊಂದಿಲ್ಲ ಎಂದು ಸ್ಪಷ್ಟಪಡಿಸಿ.

### ಸಾಮಾನ್ಯ ಪ್ರಶ್ನೆಗಳು (FAQ)

#### ಇದು Claude Code ಗಿಂತ ಹೇಗೆ ಭಿನ್ನವಾಗಿದೆ?

ಸಾಮರ್ಥ್ಯದ ವಿಷಯದಲ್ಲಿ ಇದು Claude Code ಗೆ ಬಹಳ ಹೋಲುತ್ತದೆ. ಪ್ರಮುಖ ವ್ಯತ್ಯಾಸಗಳು ಇಲ್ಲಿವೆ:

* 100% ಓಪನ್ ಸೋರ್ಸ್.
* ಯಾವುದೇ ಪೂರೈಕೆದಾರರಿಗೆ (provider) ಸೀಮಿತವಾಗಿಲ್ಲ. ನಾವು [OpenCode Zen](https://opencode.ai/zen) ಮೂಲಕ ಒದಗಿಸುವ ಮಾಡೆಲ್‌ಗಳನ್ನು ಶಿಫಾರಸು ಮಾಡಿದರೂ, OpenCode ಅನ್ನು Claude, OpenAI, Google ಅಥವಾ ಸ್ಥಳೀಯ (local) ಮಾಡೆಲ್‌ಗಳೊಂದಿಗೂ ಬಳಸಬಹುದು. ಮಾಡೆಲ್‌ಗಳು ವಿಕಸನಗೊಂಡಂತೆ, ಅವುಗಳ ನಡುವಿನ ಅಂತರ ಕಡಿಮೆಯಾಗುತ್ತದೆ ಮತ್ತು ಬೆಲೆಗಳು ಇಳಿಯುತ್ತವೆ, ಆದ್ದರಿಂದ ಪ್ರೊವೈಡರ್-ಅಗ್ನೋಸ್ಟಿಕ್ (provider-agnostic) ಆಗಿರುವುದು ಮುಖ್ಯ.
* ನೇರವಾದ (Out-of-the-box) LSP ಬೆಂಬಲ.
* TUI (Terminal UI) ಮೇಲೆ ಗಮನ. OpenCode ಅನ್ನು neovim ಬಳಕೆದಾರರು ಮತ್ತು [terminal.shop](https://terminal.shop) ನಿರ್ಮಾತೃಗಳು ನಿರ್ಮಿಸಿದ್ದಾರೆ; ಟರ್ಮಿನಲ್‌ನಲ್ಲಿ ಏನೆಲ್ಲಾ ಸಾಧ್ಯವೋ ಅದರ ಮಿತಿಯನ್ನು ನಾವು ವಿಸ್ತರಿಸಲಿದ್ದೇವೆ.
* ಕ್ಲೈಂಟ್/ಸರ್ವರ್ ಆರ್ಕಿಟೆಕ್ಚರ್. ಉದಾಹರಣೆಗೆ, ನಿಮ್ಮ ಕಂಪ್ಯೂಟರ್‌ನಲ್ಲಿ OpenCode ರನ್ ಆಗುತ್ತಿರುವಾಗ, ಮೊಬೈಲ್ ಆಪ್ ಮೂಲಕ ಅದನ್ನು ರಿಮೋಟ್ ಆಗಿ ನಿಯಂತ್ರಿಸಲು ಇದು ಅನುವು ಮಾಡಿಕೊಡುತ್ತದೆ. ಅಂದರೆ TUI ಫ್ರಂಟ್-ಎಂಡ್ ಕೇವಲ ಒಂದು ಸಾಧ್ಯತೆಯಷ್ಟೇ.

---

**ನಮ್ಮ ಸಮುದಾಯವನ್ನು ಸೇರಿ** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
