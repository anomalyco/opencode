<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logo">
    </picture>
  </a>
</p>
<p align="center">The open source AI coding agent.</p>
<p align="center">
  <a href="https://opencode.ai/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/opencode-ai"><img alt="npm" src="https://img.shields.io/npm/v/opencode-ai?style=flat-square" /></a>
  <a href="https://github.com/iamcheyan/opencode/actions"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/iamcheyan/opencode/build-cli.yml?style=flat-square&branch=main" /></a>
</p>

[![OpenCode Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://opencode.ai)

---

## 🎯 About This Fork

This is a fork of [opencode](https://github.com/anomalyco/opencode) that focuses on providing a **minimal CLI mode** by default.

### Why This Fork?

The original opencode has a powerful TUI (Terminal User Interface) mode, but we believe many developers prefer a simpler, text-based interface. This fork was created to serve users who:

1. **Work in remote environments**: SSH sessions, tmux, CI/CD pipelines where rich TUI rendering may not work well
2. **Prefer minimal interfaces**: Developers who like plain text terminals that integrate with their existing workflow
3. **Need better accessibility**: Screen readers and assistive technologies work better with simple text interfaces
4. **Want resource efficiency**: The minimal mode uses significantly less memory and CPU

### What's Different?

| Feature | Upstream (anomalyco/opencode) | This Fork (iamcheyan/opencode) |
|---------|------------------------------|--------------------------------|
| **Default Mode** | TUI (Terminal UI) | **Minimal CLI (REPL)** |
| **Interface** | Rich, interactive TUI | Simple, text-based readline |
| **Resource Usage** | Higher | **Lower** |
| **Terminal Compatibility** | Requires good terminal support | **Works everywhere** |
| **Accessibility** | Limited | **Better screen reader support** |

### Key Features

- ✅ **Default Minimal Mode**: Starts in REPL mode by default - no configuration needed
- ✅ **22 Slash Commands**: Full command support matching TUI functionality
- ✅ **Tab Autocomplete**: Easy command completion
- ✅ **Session Management**: Create, fork, share, export sessions
- ✅ **Cross-Platform**: Builds for macOS, Linux, and Windows
- ✅ **Upstream Sync**: Regular synchronization with upstream for latest features and fixes

---

## 📦 Installation

### Download Binary (Recommended)

Download the latest binary for your platform from the [Releases](https://github.com/iamcheyan/opencode/releases) page.

**Available platforms:**
- macOS (Apple Silicon & Intel)
- Linux (x64, ARM64, musl variants)
- Windows (x64, ARM64)

### Using npm

```bash
npm install -g opencode-ai
```

### Using curl

```bash
curl -fsSL https://opencode.ai/install | bash
```

---

## 🚀 Quick Start

### Basic Usage

```bash
# Start minimal CLI mode (default)
opencode

# Start with a specific directory
opencode /path/to/project

# Continue last session
opencode --continue

# Start with initial prompt
opencode -p "Help me refactor this function"
```

### Slash Commands

Once in the REPL, type `/` and press Tab to see all available commands:

```
/new               Create new session
/sessions          List recent sessions
/fork              Fork current session
/share             Share session
/export            Export to file
/model [name]      Switch model
/agent [name]      Switch agent
/thinking          Toggle thinking display
/timestamps        Toggle timestamps
/help              Show all commands
```

### Switching to TUI Mode

If you want to use the original TUI mode:

```bash
# Use TUI mode
opencode --mode tui

# Or use the upstream version
# Download from: https://github.com/anomalyco/opencode
```

---

## 🔧 Development

### Building from Source

```bash
# Clone the repository
git clone https://github.com/iamcheyan/opencode.git
cd opencode

# Install dependencies
bun install

# Build CLI binaries
cd packages/opencode
bun run script/build.ts
```

### Syncing with Upstream

This fork regularly syncs with upstream to get the latest features and bug fixes. We provide a script to handle this while preserving our custom settings:

```bash
# Recommended sync method
./scripts/sync-upstream.sh
```

For manual sync instructions or troubleshooting (including network issues), see the [Maintenance Guide](MAINTENANCE.md).

---

## 📋 Fork Maintenance

### How We Stay Updated

1. **Regular Sync**: We sync with upstream weekly
2. **Conflict Resolution**: Our minimal mode is preserved during merges
3. **Testing**: All changes are tested before release
4. **Versioning**: We follow upstream versioning with `-minimal` suffix

### Release Process

```bash
# Create a new release
git tag v0.1.0-minimal
git push origin v0.1.0-minimal

# GitHub Actions automatically builds binaries
# for all platforms
```

---

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Focus Areas

- Improving the minimal CLI experience
- Adding new slash commands
- Performance optimizations
- Better terminal compatibility

---

## 📄 License

This project is licensed under the same terms as the original opencode. See [LICENSE](LICENSE) for details.

---

## 🙏 Acknowledgments

This fork would not be possible without the excellent work of the [opencode team](https://github.com/anomalyco/opencode). We are grateful for their open source contribution.

---

## 📞 Contact

- **Issues**: [GitHub Issues](https://github.com/iamcheyan/opencode/issues)
- **Discussions**: [GitHub Discussions](https://github.com/iamcheyan/opencode/discussions)
- **Discord**: [opencode Discord](https://opencode.ai/discord)

---

## 🔗 Links

- **Upstream**: [anomalyco/opencode](https://github.com/anomalyco/opencode)
- **Website**: [opencode.ai](https://opencode.ai)
- **Documentation**: [opencode.ai/docs](https://opencode.ai/docs)
