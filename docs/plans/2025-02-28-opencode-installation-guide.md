# OpenCode — Comprehensive Installation Guide

> **Product:** OpenCode (AI Coding Agent)  
> **CLI Command:** `opencode`  
> **Desktop App (Prax Dev Build):** "OpenCode Prax-Dev"  
> **Branch:** `prax-dev`  
> **Date:** 2025-02-28

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [CLI Installation](#cli-installation)
   - [Quick Install (curl)](#quick-install-curl)
   - [Package Managers](#package-managers)
   - [From Source](#from-source)
3. [Desktop Application](#desktop-application)
   - [Pre-built DMG (macOS)](#pre-built-dmg-macos)
   - [Building from Source](#building-the-desktop-app-from-source)
4. [Post-Installation Setup](#post-installation-setup)
5. [Prax-Dev Build Specifics](#prax-dev-build-specifics)
6. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### For CLI Usage
| Requirement | Version | Notes |
|---|---|---|
| **macOS / Linux / Windows** | Any modern | Windows via WSL recommended |
| **API Key** | — | At minimum one of: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, or other supported provider key |

### For Building from Source
| Requirement | Version | Notes |
|---|---|---|
| **Bun** | ≥ 1.3 | Runtime and package manager. Install: `curl -fsSL https://bun.sh/install \| bash` |
| **Node.js** | ≥ 20 | Required by some tooling (tsgo, etc.) |
| **Git** | Any | For cloning |
| **Rust + Cargo** | stable | Only for desktop app builds (Tauri) |
| **Xcode CLI Tools** | Latest | macOS only — `xcode-select --install` |

---

## CLI Installation

### Quick Install (curl)

The fastest way to install the `opencode` CLI:

```bash
curl -fsSL https://opencode.ai/install | bash
```

This script:
- Auto-detects your OS (macOS/Linux/Windows) and architecture (arm64/x64)
- Detects musl vs glibc on Linux, x64 baseline (no AVX2) variants
- Downloads the latest release from GitHub
- Installs to `$HOME/.opencode/bin`
- Adds the bin directory to your shell PATH (fish/zsh/bash/ash/sh)

**Options:**
```bash
# Install a specific version
curl -fsSL https://opencode.ai/install | bash -s -- --version 1.2.15

# Don't modify shell config (manual PATH setup)
curl -fsSL https://opencode.ai/install | bash -s -- --no-modify-path

# Install from a local binary
curl -fsSL https://opencode.ai/install | bash -s -- --binary ./path/to/opencode
```

**Install directory priority:** `$OPENCODE_INSTALL_DIR` → `$XDG_BIN_DIR` → `$HOME/bin` (if on PATH) → `$HOME/.opencode/bin`

After installation, open a new terminal (or `source` your shell config), then verify:

```bash
opencode --version
```

### Package Managers

#### npm / Bun / pnpm / Yarn
```bash
# npm (global)
npm i -g opencode-ai@latest

# Bun (global)
bun i -g opencode-ai@latest

# pnpm
pnpm i -g opencode-ai@latest

# Yarn
yarn global add opencode-ai@latest
```

#### Homebrew (macOS / Linux)
```bash
brew install opencode-ai/tap/opencode
```

#### Scoop (Windows)
```powershell
scoop bucket add opencode https://github.com/anomalyco/scoop-bucket
scoop install opencode
```

#### Chocolatey (Windows)
```powershell
choco install opencode-ai
```

#### Arch Linux (pacman / paru)
```bash
paru -S opencode-ai-bin
```

#### mise
```bash
mise use -g opencode-ai@latest
```

#### Nix
```bash
# Run directly
nix run github:anomalyco/opencode

# Or install into profile
nix profile install github:anomalyco/opencode
```

### From Source

```bash
# 1. Clone the repository
git clone https://github.com/anomalyco/opencode.git
cd opencode

# 2. Install dependencies
bun install

# 3. Build the CLI
cd packages/opencode
bun run build

# 4. The CLI binary is now at packages/opencode/bin/opencode
# Run it directly:
bun run --conditions=browser ./src/index.ts --help

# Or link it globally:
bun link
```

**For the prax-dev branch:**
```bash
git clone https://github.com/PrakharMNNIT/opencode.git
cd opencode
git checkout prax-dev
bun install
cd packages/opencode
bun run build
```

The CLI binary name is always **`opencode`** (defined in `packages/opencode/package.json` under `"bin"`).

---

## Desktop Application

The desktop app is a **Tauri 2** application that bundles the web UI with a native window and an `opencode` CLI sidecar binary.

### Pre-built DMG (macOS)

For the official release builds, download from [GitHub Releases](https://github.com/anomalyco/opencode/releases):
- **macOS:** `.dmg` file — mount, drag to Applications
- **Windows:** `.exe` (NSIS installer)
- **Linux:** `.deb`, `.rpm`, or `.AppImage`

> **Note:** The `prax-dev` build produces a DMG named **"OpenCode Prax-Dev"** with custom prax-dev icons and the identifier `ai.opencode.desktop.prax-dev`. This build runs side-by-side with production OpenCode.

### Building the Desktop App from Source

#### Prerequisites (Additional)
| Requirement | Notes |
|---|---|
| **Rust (stable)** | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| **Tauri CLI** | Installed as a dev dependency, or: `cargo install tauri-cli` |
| **System libs** | macOS: Xcode CLI tools. Linux: `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`, `patchelf` |

#### Build Steps

```bash
# 1. Clone and install (if not done already)
git clone https://github.com/PrakharMNNIT/opencode.git
cd opencode
git checkout prax-dev
bun install

# 2. Build the CLI sidecar first
cd packages/opencode
bun run build
cd ../..

# 3. Copy the CLI binary to the sidecar location
# The predev script handles this automatically:
cd packages/desktop
bun run predev

# 4. Build the desktop app (uses tauri.conf.json — prax-dev config)
bun run tauri build

# 5. Find your output:
#    macOS DMG:  packages/desktop/src-tauri/target/release/bundle/dmg/
#    macOS App:  packages/desktop/src-tauri/target/release/bundle/macos/
#    Windows:    packages/desktop/src-tauri/target/release/bundle/nsis/
#    Linux:      packages/desktop/src-tauri/target/release/bundle/deb/
```

#### Development Mode

```bash
# Option A: Full dev mode (backend + frontend together)
cd packages/desktop
bun run tauri dev

# Option B: Backend and frontend separately (for UI development)
# Terminal 1 — Backend server:
cd packages/opencode
bun run --conditions=browser ./src/index.ts serve --port 4096

# Terminal 2 — Frontend dev server:
cd packages/app
bun dev -- --port 4444

# Open http://localhost:4444 to see live UI changes
```

> ⚠️ **Important:** `opencode dev web` proxies `https://app.opencode.ai`, so local UI/CSS changes will NOT show there. Use the separate server approach (Option B) for UI development.

---

## Post-Installation Setup

### 1. Configure an API Provider

Set at least one API key as an environment variable:

```bash
# Anthropic (Claude)
export ANTHROPIC_API_KEY="sk-ant-..."

# OpenAI
export OPENAI_API_KEY="sk-..."

# Google (Gemini)
export GOOGLE_GENERATIVE_AI_API_KEY="AI..."

# Or use OpenRouter, AWS Bedrock, Azure, etc.
```

Add to your `~/.zshrc`, `~/.bashrc`, or shell config for persistence.

### 2. Verify Installation

```bash
# Check version
opencode --version

# Launch interactive TUI
opencode

# Launch with a specific project directory
opencode /path/to/project

# Start the API server (for web/desktop UI)
opencode serve

# Start with web UI
opencode dev web
```

### 3. Theme Configuration

OpenCode supports multiple themes, including the **Aurora** design system (added in this prax-dev branch):
- **Aurora Dark** — "Digital luminescence" — elements emit light into void
- **Aurora Light** — "Prismatic refraction" — light refracts through crystal

Themes can be selected in the settings dialog within the UI.

---

## Prax-Dev Build Specifics

The `prax-dev` branch is a customized development build with the following differences from upstream:

| Aspect | Upstream (`dev`) | Prax-Dev (`prax-dev`) |
|---|---|---|
| **Product Name** | "OpenCode" | "OpenCode Prax-Dev" |
| **Bundle ID** | `ai.opencode.desktop` | `ai.opencode.desktop.prax-dev` |
| **Icon Set** | `icons/prod/` | `icons/prax-dev/` |
| **Tauri Config** | `tauri.conf.json` | `tauri.conf.json` (modified for prax-dev) |
| **Aurora Theme** | Not yet merged | ✅ Full Aurora design system |
| **CLI Command** | `opencode` | `opencode` (same) |
| **Can Coexist** | — | Yes, different bundle ID allows side-by-side install |

### Sidecar Binaries

The desktop app bundles the CLI as a sidecar. Supported targets:

| Target Triple | Platform |
|---|---|
| `aarch64-apple-darwin` | macOS Apple Silicon |
| `x86_64-apple-darwin` | macOS Intel |
| `x86_64-pc-windows-msvc` | Windows x64 |
| `x86_64-unknown-linux-gnu` | Linux x64 |
| `aarch64-unknown-linux-gnu` | Linux ARM64 |

---

## Troubleshooting

### CLI not found after installation
```bash
# Reload your shell config
source ~/.zshrc  # or ~/.bashrc

# Or manually add to PATH
export PATH="$HOME/.opencode/bin:$PATH"
```

### API key errors
```bash
# Verify your key is set
echo $ANTHROPIC_API_KEY

# Check OpenCode sees it
opencode --help
```

### Desktop app — sidecar not found
```bash
# Rebuild the sidecar
cd packages/opencode && bun run build
cd ../desktop && bun run predev
```

### Build errors on macOS
```bash
# Ensure Xcode CLI tools are installed
xcode-select --install

# Ensure Rust is up to date
rustup update stable
```

### Build errors on Linux
```bash
# Install required system libraries (Ubuntu/Debian)
sudo apt install -y \
  libwebkit2gtk-4.1-dev \
  libappindicator3-dev \
  librsvg2-dev \
  patchelf \
  libssl-dev \
  pkg-config
```

### Nix build
```bash
# Build CLI via Nix
nix build github:anomalyco/opencode#opencode

# Build desktop via Nix
nix build github:anomalyco/opencode#desktop
```

---

*Guide compiled: 2025-02-28 | Branch: prax-dev | CLI version: 1.2.15*
