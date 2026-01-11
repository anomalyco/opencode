<p align="center">
  <a href="https://crazycode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="CrazyCode logo">
    </picture>
  </a>
</p>
<p align="center">The open source AI coding agent.</p>
<p align="center">
  <a href="https://crazycode.ai/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/crazycode-ai"><img alt="npm" src="https://img.shields.io/npm/v/crazycode-ai?style=flat-square" /></a>
  <a href="https://github.com/anomalyco/crazycode/actions/workflows/publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/anomalyco/crazycode/publish.yml?style=flat-square&branch=dev" /></a>
</p>

[![CrazyCode Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://crazycode.ai)

---

### Installation

```bash
# YOLO
curl -fsSL https://crazycode.ai/install | bash

# Package managers
npm i -g crazycode-ai@latest        # or bun/pnpm/yarn
scoop bucket add extras; scoop install extras/crazycode  # Windows
choco install crazycode             # Windows
brew install anomalyco/tap/crazycode # macOS and Linux (recommended, always up to date)
brew install crazycode              # macOS and Linux (official brew formula, updated less)
paru -S crazycode-bin               # Arch Linux
mise use -g crazycode               # Any OS
nix run nixpkgs#crazycode           # or github:anomalyco/crazycode for latest dev branch
```

> [!TIP]
> Remove versions older than 0.1.x before installing.

### Desktop App (BETA)

CrazyCode is also available as a desktop application. Download directly from the [releases page](https://github.com/anomalyco/crazycode/releases) or [crazycode.ai/download](https://crazycode.ai/download).

| Platform              | Download                              |
| --------------------- | ------------------------------------- |
| macOS (Apple Silicon) | `crazycode-desktop-darwin-aarch64.dmg` |
| macOS (Intel)         | `crazycode-desktop-darwin-x64.dmg`     |
| Windows               | `crazycode-desktop-windows-x64.exe`    |
| Linux                 | `.deb`, `.rpm`, or AppImage           |

```bash
# macOS (Homebrew)
brew install --cask crazycode-desktop
```

#### Installation Directory

The install script respects the following priority order for the installation path:

1. `$CRAZYCODE_INSTALL_DIR` - Custom installation directory
2. `$XDG_BIN_DIR` - XDG Base Directory Specification compliant path
3. `$HOME/bin` - Standard user binary directory (if exists or can be created)
4. `$HOME/.crazycode/bin` - Default fallback

```bash
# Examples
CRAZYCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://crazycode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://crazycode.ai/install | bash
```

### Agents

CrazyCode includes two built-in agents you can switch between with the `Tab` key.

- **build** - Default, full access agent for development work
- **plan** - Read-only agent for analysis and code exploration
  - Denies file edits by default
  - Asks permission before running bash commands
  - Ideal for exploring unfamiliar codebases or planning changes

Also, included is a **general** subagent for complex searches and multistep tasks.
This is used internally and can be invoked using `@general` in messages.

Learn more about [agents](https://crazycode.ai/docs/agents).

### Documentation

For more info on how to configure CrazyCode [**head over to our docs**](https://crazycode.ai/docs).

### Contributing

If you're interested in contributing to CrazyCode, please read our [contributing docs](./CONTRIBUTING.md) before submitting a pull request.

### Building on CrazyCode

If you are working on a project that's related to CrazyCode and is using "crazycode" as a part of its name; for example, "crazycode-dashboard" or "crazycode-mobile", please add a note to your README to clarify that it is not built by the CrazyCode team and is not affiliated with us in any way.

### FAQ

#### How is this different from Claude Code?

It's very similar to Claude Code in terms of capability. Here are the key differences:

- 100% open source
- Not coupled to any provider. Although we recommend the models we provide through [CrazyCode Zen](https://crazycode.ai/zen); CrazyCode can be used with Claude, OpenAI, Google or even local models. As models evolve the gaps between them will close and pricing will drop so being provider-agnostic is important.
- Out of the box LSP support
- A focus on TUI. CrazyCode is built by neovim users and the creators of [terminal.shop](https://terminal.shop); we are going to push the limits of what's possible in the terminal.
- A client/server architecture. This for example can allow CrazyCode to run on your computer, while you can drive it remotely from a mobile app. Meaning that the TUI frontend is just one of the possible clients.

---

**Join our community** [Discord](https://discord.gg/crazycode) | [X.com](https://x.com/crazycode)
