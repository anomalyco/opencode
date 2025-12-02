<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logo" width="400">
    </picture>
  </a>
</p>

<h3 align="center">The open-source AI coding agent for your terminal</h3>

<p align="center">
  <a href="https://opencode.ai/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=Discord&color=5865F2" /></a>
  <a href="https://www.npmjs.com/package/opencode-ai"><img alt="npm" src="https://img.shields.io/npm/v/opencode-ai?style=flat-square&label=npm&color=CB3837" /></a>
  <a href="https://github.com/sst/opencode/actions/workflows/publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/sst/opencode/publish.yml?style=flat-square&branch=dev&label=Build" /></a>
  <a href="https://github.com/sst/opencode/blob/dev/LICENSE"><img alt="License" src="https://img.shields.io/github/license/sst/opencode?style=flat-square&label=License" /></a>
</p>

<p align="center">
  <a href="https://opencode.ai/docs">Documentation</a> |
  <a href="https://opencode.ai/docs/agents">Agents</a> |
  <a href="https://opencode.ai/zen">OpenCode Zen</a> |
  <a href="https://opencode.ai/discord">Community</a>
</p>

---

[![OpenCode Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://opencode.ai)

## Features

- **100% Open Source** - Fully transparent, community-driven development
- **Provider Agnostic** - Works with Claude, OpenAI, Google, Azure, local models, and more
- **Built-in LSP Support** - Language Server Protocol integration out of the box
- **Terminal-First Design** - Crafted by Neovim enthusiasts for power users
- **Client/Server Architecture** - Run locally, control remotely from any device
- **Multiple Agents** - Switch between build and plan modes for different workflows

---

## Quick Start

```bash
# One-line install
curl -fsSL https://opencode.ai/install | bash

# Then run
opencode
```

## Installation

Choose your preferred installation method:

### Package Managers

| Platform | Command |
|----------|---------|
| **npm/bun/pnpm/yarn** | `npm i -g opencode-ai@latest` |
| **Homebrew** (macOS/Linux) | `brew install opencode` |
| **Scoop** (Windows) | `scoop bucket add extras && scoop install extras/opencode` |
| **Chocolatey** (Windows) | `choco install opencode` |
| **Arch Linux** | `paru -S opencode-bin` |
| **mise** | `mise use --pin -g ubi:sst/opencode` |
| **Nix** | `nix run nixpkgs#opencode` |

> [!TIP]
> Remove versions older than 0.1.x before installing.

### Custom Installation Directory

The install script respects these paths in order of priority:

1. `$OPENCODE_INSTALL_DIR` - Custom directory
2. `$XDG_BIN_DIR` - XDG compliant path
3. `$HOME/bin` - User binary directory
4. `$HOME/.opencode/bin` - Default fallback

```bash
# Custom install examples
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

---

## Agents

OpenCode provides multiple agents optimized for different workflows. Switch between them using the `Tab` key.

| Agent | Description | Best For |
|-------|-------------|----------|
| **build** | Full access agent (default) | Active development, writing code, running commands |
| **plan** | Read-only analysis agent | Exploring codebases, planning changes, code review |
| **general** | Complex task subagent | Multi-step searches, invoked via `@general` |

The **plan** agent is particularly useful when:
- Exploring unfamiliar codebases safely
- Planning architectural changes before implementation
- Reviewing code without accidental modifications

Learn more about [agents in our documentation](https://opencode.ai/docs/agents).

---

## Configuration

OpenCode can be configured via:
- `opencode.json` in your project root
- `~/.config/opencode/config.json` for global settings

For detailed configuration options, see our [documentation](https://opencode.ai/docs).

---

## Contributing

We welcome contributions! Please read our [contributing guide](./CONTRIBUTING.md) before submitting a pull request.

### Building on OpenCode

If you're creating a project related to OpenCode (e.g., "opencode-dashboard", "opencode-mobile"), please clarify in your README that it's a community project and not officially affiliated with the OpenCode team.

---

## FAQ

<details>
<summary><strong>What makes OpenCode different from other AI coding tools?</strong></summary>

OpenCode stands out through:

- **Complete transparency** - 100% open source codebase
- **Provider flexibility** - Use any LLM provider or local models via [OpenCode Zen](https://opencode.ai/zen)
- **Native LSP integration** - Language-aware assistance out of the box
- **Terminal-first philosophy** - Built by terminal power users for terminal power users
- **Extensible architecture** - Client/server design enables remote control and custom integrations

</details>

<details>
<summary><strong>Which AI providers are supported?</strong></summary>

OpenCode supports a wide range of providers:
- Anthropic Claude
- OpenAI
- Google (Gemini, Vertex AI)
- Azure OpenAI
- Amazon Bedrock
- OpenRouter
- Local models (via OpenAI-compatible APIs)

</details>

<details>
<summary><strong>What's the story behind the name?</strong></summary>

There's another repository with a similar name - you can [read about it here](https://x.com/thdxr/status/1933561254481666466).

</details>

---

## Community

Join our growing community of developers:

<p align="center">
  <a href="https://discord.gg/opencode"><img src="https://img.shields.io/badge/Discord-Join%20Server-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord" /></a>
  <a href="https://x.com/opencode"><img src="https://img.shields.io/badge/X.com-Follow-000000?style=for-the-badge&logo=x&logoColor=white" alt="X.com" /></a>
</p>

