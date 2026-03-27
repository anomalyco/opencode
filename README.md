<p align="center">
  <img src="assets/logo.svg" alt="CoBuilder" width="420" />
</p>

<p align="center"><strong>The open source AI agent — build software, automate workflows, and ship faster.</strong></p>

<p align="center">
  <a href="https://github.com/CobuilderLabs/opencode/releases/latest"><img alt="Latest Release" src="https://img.shields.io/github/v/release/CobuilderLabs/opencode?filter=cb-v*&style=flat-square&label=release&color=0f6" /></a>
  <a href="https://github.com/CobuilderLabs/opencode/actions/workflows/cd.yml"><img alt="Build" src="https://img.shields.io/github/actions/workflow/status/CobuilderLabs/opencode/cd.yml?style=flat-square&branch=main&label=build" /></a>
  <a href="https://github.com/CobuilderLabs/opencode/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/CobuilderLabs/opencode/ci.yml?style=flat-square&label=CI" /></a>
  <a href="LICENSE"><img alt="MIT" src="https://img.shields.io/github/license/CobuilderLabs/opencode?style=flat-square" /></a>
</p>

---

## What is CoBuilder?

CoBuilder is an **AI agent** — not just a coding assistant. It can build software, create automations, plan projects, generate content, and execute multi-step tasks end-to-end, all from your terminal or browser.

It runs locally, works with any AI provider, and is built for teams that need reliability, security, and control.

CoBuilder is a fork of [opencode](https://github.com/anomalyco/opencode) with enterprise-grade additions: **security hardening**, **cross-session AI memory**, **crash recovery**, and **guided provider onboarding**.

---

## Why CoBuilder?

|                                                  | CoBuilder | Plain coding assistants |
| ------------------------------------------------ | --------- | ----------------------- |
| Builds beyond code (automations, plans, content) | ✅        | ❌                      |
| Remembers context across sessions                | ✅        | ❌                      |
| Recovers from crashes automatically              | ✅        | ❌                      |
| SSRF + prompt injection protection               | ✅        | ❌                      |
| Tamper-proof audit log                           | ✅        | ❌                      |
| Works with any AI provider                       | ✅        | Varies                  |
| Fully local — no cloud, no data sent out         | ✅        | Rarely                  |
| Open source                                      | ✅        | Rarely                  |

---

## Quick Start

**1. Install**

```bash
curl -fsSL https://raw.githubusercontent.com/CobuilderLabs/opencode/main/install.sh | bash
```

No Node.js, no npm, no dependencies. The installer picks the right binary for your OS and places it in `~/.local/bin/`.

> **Windows:** Run in Git Bash or WSL.

**2. Connect an AI provider**

```bash
cobuilder onboard
```

You'll be walked through a guided setup:

```
  ┌─────────────────────────────────────────┐
  │  Welcome to CoBuilder                   │
  │  Let's get you set up                   │
  └─────────────────────────────────────────┘

  Which provider would you like to use?
  ❯  9Router    — Local OpenAI-compatible proxy
     Anthropic  — Claude models via API key
     OpenAI     — GPT models via API key
     OpenRouter — 200+ models via one key
     Google     — Gemini models via API key
```

Select a provider, paste your API key (or URL for local proxies), and you're done. Run `cobuilder onboard` anytime to add more.

**3. Start building**

```bash
cobuilder                              # open the terminal UI
cobuilder run "scaffold a REST API"    # run a task non-interactively
cobuilder web                          # open in browser
```

---

## Download

Pre-built binaries for every platform — [**latest release →**](https://github.com/CobuilderLabs/opencode/releases/latest)

| Platform              | Download                                                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| macOS (Apple Silicon) | [`cobuilder-darwin-arm64.zip`](https://github.com/CobuilderLabs/opencode/releases/latest/download/cobuilder-darwin-arm64.zip)     |
| macOS (Intel)         | [`cobuilder-darwin-x64.zip`](https://github.com/CobuilderLabs/opencode/releases/latest/download/cobuilder-darwin-x64.zip)         |
| Windows (x64)         | [`cobuilder-windows-x64.zip`](https://github.com/CobuilderLabs/opencode/releases/latest/download/cobuilder-windows-x64.zip)       |
| Windows (ARM64)       | [`cobuilder-windows-arm64.zip`](https://github.com/CobuilderLabs/opencode/releases/latest/download/cobuilder-windows-arm64.zip)   |
| Linux (x64)           | [`cobuilder-linux-x64.tar.gz`](https://github.com/CobuilderLabs/opencode/releases/latest/download/cobuilder-linux-x64.tar.gz)     |
| Linux (ARM64)         | [`cobuilder-linux-arm64.tar.gz`](https://github.com/CobuilderLabs/opencode/releases/latest/download/cobuilder-linux-arm64.tar.gz) |

> **Desktop App (BETA)** — Windows and Linux installers on the [latest release →](https://github.com/CobuilderLabs/opencode/releases/latest). macOS coming soon.

**Install to a custom path:**

```bash
COBUILDER_INSTALL_DIR=/usr/local/bin curl -fsSL https://raw.githubusercontent.com/CobuilderLabs/opencode/main/install.sh | bash
```

---

## Features

### Cross-session memory

CoBuilder summarizes what happened at the end of each session — files touched, commands run, decisions made — and stores it in a local full-text search index. On your next session, it searches that history for relevant context and quietly injects it into the system prompt. Your agent remembers your project without you re-explaining it every time.

### Crash recovery

If the CoBuilder server exits unexpectedly, the next launch detects the interrupted session and offers to resume exactly where you left off. No work is lost.

```bash
cobuilder --continue          # resume the last session
cobuilder -s <session-id>     # resume a specific session
```

The session ID is shown when you exit: `cobuilder -s ses_xxx`.

### Terminal-first interface

Full terminal UI with syntax-highlighted output, streaming responses, and keyboard-driven navigation. Press `Tab` to switch between the `build` agent (full file access) and `plan` agent (read-only analysis). Press `/` to open the command palette.

### LSP integration

Language server diagnostics — errors, warnings, type information — flow directly into the AI's context. The agent sees the same problems your editor sees, in real time.

### Client/server architecture

`cobuilder serve` starts a local API server. The TUI and web UI are both clients, so you can run CoBuilder on a remote machine and drive it from your laptop, a browser, or a custom client.

### MCP support

Connect any [Model Context Protocol](https://modelcontextprotocol.io) server to extend CoBuilder with external tools, data sources, or APIs.

```bash
cobuilder mcp    # manage MCP connections
```

---

## AI Providers

CoBuilder works with any of the following. You are never locked in to one.

| Provider            | Description                                                                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **9Router**         | Local OpenAI-compatible proxy. No data leaves your machine. Ideal for air-gapped or regulated environments.                                    |
| **Anthropic**       | Claude 3.5 Sonnet, Claude 3 Haiku, Claude Opus. Best-in-class reasoning and code generation.                                                   |
| **OpenAI**          | GPT-4o, o1, o3-mini, and the full OpenAI model lineup.                                                                                         |
| **OpenRouter**      | A single API key routing to 200+ models. Good for teams comparing models or managing cost centrally.                                           |
| **GitHub Copilot**  | Uses your existing Copilot subscription via GitHub's Device Code OAuth flow. No additional API key. Supports GitHub.com and GitHub Enterprise. |
| **Google**          | Gemini 2.0 Flash and Gemini 2.5 Pro.                                                                                                           |
| **Custom endpoint** | Any server that speaks the OpenAI API format works — configure via 9Router or directly in `opencode.json`.                                     |

---

## Security

CoBuilder is designed to be safe in team and enterprise environments.

| Protection                     | What it does                                                                                                                                                                       |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SSRF protection**            | Validates provider URLs before any network request. Rejects cloud metadata endpoints (AWS, GCP, Azure), private RFC-1918 ranges, and localhost unless explicitly allowed.          |
| **Prompt injection detection** | Scans file/tool content for patterns that try to override the system prompt, exfiltrate data, or execute shell injection. Detections are logged before reaching the model.         |
| **Path traversal prevention**  | Every file path is canonicalized and checked against the allowed base directory. Paths with `../`, symlink escapes, or null bytes are rejected.                                    |
| **Audit log**                  | All sensitive operations (file writes, shell commands, provider calls) are recorded in a SHA-256 chained append-only log that cannot be silently tampered with.                    |
| **Rate limiting**              | Per-client token-bucket rate limiting in server mode prevents API quota from being burned unexpectedly.                                                                            |
| **Security headers**           | All HTTP responses include `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, and `Referrer-Policy: no-referrer`. |
| **Supply chain**               | Every PR runs TruffleHog (secret scanning), CodeQL static analysis, and a dependency audit.                                                                                        |

To report a vulnerability, email **security@cobuilder.dev**. We acknowledge within 48 hours. See [SECURITY.md](SECURITY.md) for the full disclosure policy.

---

## Enterprise Deployment

**Air-gap ready.** Use 9Router as your local model proxy. Once configured, CoBuilder makes no external network requests — all AI inference stays inside your network.

**Data stays local.** Sessions, cross-session memory, checkpoints, and audit logs are all stored in SQLite on the local filesystem. Nothing is sent to a CoBuilder service or cloud.

**No registry dependency.** Pre-built binaries are published directly to GitHub Releases. Mirror them internally and point your install script there, or build from source with a single `bun run build`.

**Bring your own provider contracts.** If your company has negotiated API pricing with Anthropic, OpenAI, or others, CoBuilder works with those keys directly. No middleman.

**Crash resilience.** The checkpoint system means an unexpected server restart doesn't lose in-progress sessions.

For custom deployments, enterprise support, or procurement questions, open an issue or reach out directly.

---

## Configuration

Config lives at `~/.config/opencode/opencode.json`. The `cobuilder onboard` command writes this for you, but you can edit it manually.

```jsonc
{
  // Default model (provider/model-id)
  "model": "anthropic/claude-sonnet-4-5",

  // Limit which providers are active
  "enabled_providers": ["anthropic"],

  // Provider credentials and models (populated by onboard)
  "provider": {
    "anthropic": {},
  },
}
```

**9Router example:**

```jsonc
{
  "model": "9router/llama-3.1-70b",
  "provider": {
    "9router": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "9Router",
      "options": {
        "baseURL": "http://localhost:20123/v1",
        "apiKey": "9router",
      },
      "models": {
        "llama-3.1-70b": { "name": "llama-3.1-70b" },
      },
    },
  },
}
```

---

## Platform Support

| Platform | Architectures                                                               |
| -------- | --------------------------------------------------------------------------- |
| Linux    | x64, arm64 (glibc and musl/Alpine/Docker, with AVX2-free baseline variants) |
| macOS    | Apple Silicon (arm64), Intel (x64)                                          |
| Windows  | x64, arm64                                                                  |

---

## Development

**Prerequisites:** [Bun](https://bun.sh) >= 1.3.11

```bash
git clone https://github.com/CobuilderLabs/opencode.git
cd opencode
bun install

# Run from source
bun run opencode

# Interactive onboarding
bun run onboard

# Build a binary for the current platform
cd packages/opencode && bun run build --single
```

**Project layout:**

```
packages/
  opencode/        CLI + server (TypeScript/Bun)
    src/
      cli/         Commands: run, serve, web, onboard, mcp, ...
      session/     Session lifecycle + crash recovery checkpoint
      memory/      Cross-session memory: store, search, inject
      security/    SSRF, path traversal, prompt injection, audit log
      provider/    AI provider adapters and model registry
      storage/     SQLite database and schema migrations
  app/             Web UI (SolidJS)
  console/         Console app
```

**Tests and type checking:**

```bash
bun test             # unit tests
bun run typecheck    # TypeScript
```

---

## CI/CD

Every pull request runs: **typecheck → lint → unit tests → dependency audit → secret scan (TruffleHog) → SAST (CodeQL)**. Every merge to `main` automatically versions, releases, and publishes binaries for all platforms.

Releases use [Conventional Commits](https://www.conventionalcommits.org/) for automatic versioning: `feat:` bumps minor, `fix:`/`chore:` bump patch, breaking changes bump major. Tags use the `cb-v` prefix (`cb-v0.4.0`) to stay independent from upstream opencode releases.

The `dev` branch receives automated weekly syncs from [anomalyco/opencode](https://github.com/anomalyco/opencode). Clean merges land automatically; conflicts open a PR for human review.

---

## Contributing

1. Fork the repo and branch from `main`: `git checkout -b feat/your-feature`
2. Commit with [Conventional Commit](https://www.conventionalcommits.org/) messages (`feat:`, `fix:`, `docs:`, etc.)
3. Open a pull request — CI runs automatically
4. A maintainer will review and squash-merge once CI is green

> **Maintainers:** PRs from org members bypass the review requirement — squash-merge directly once CI passes.

---

## Upstream & Attribution

CoBuilder is a fork of [anomalyco/opencode](https://github.com/anomalyco/opencode). The core TUI, client/server architecture, LSP integration, and provider adapter system come from that project. CoBuilder adds enterprise hardening on top. We are not affiliated with the opencode team.

---

## License

[MIT](LICENSE)
