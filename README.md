<p align="center">
  <img src="packages/opencode/src/cli/ui/logo.svg" alt="CoBuilder logo" width="200" />
</p>

<h1 align="center">CoBuilder</h1>
<p align="center"><strong>The enterprise-grade, open source AI coding agent.</strong></p>

<p align="center">
  <a href="https://github.com/CobuilderLabs/opencode/releases/latest"><img alt="Latest Release" src="https://img.shields.io/github/v/release/CobuilderLabs/opencode?filter=cb-v*&style=flat-square&label=release" /></a>
  <a href="https://github.com/CobuilderLabs/opencode/actions/workflows/cd.yml"><img alt="CD status" src="https://img.shields.io/github/actions/workflow/status/CobuilderLabs/opencode/cd.yml?style=flat-square&branch=main&label=build" /></a>
  <a href="https://github.com/CobuilderLabs/opencode/actions/workflows/ci.yml"><img alt="CI status" src="https://img.shields.io/github/actions/workflow/status/CobuilderLabs/opencode/ci.yml?style=flat-square&label=CI" /></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/github/license/CobuilderLabs/opencode?style=flat-square" /></a>
</p>

---

CoBuilder is a fork of [opencode](https://github.com/anomalyco/opencode) hardened for enterprise and team use. It adds security, cross-session memory, crash recovery, and a multi-provider onboarding flow — while staying fully open source and provider-agnostic.

## Quick Install

```bash
curl -fsSL https://raw.githubusercontent.com/CobuilderLabs/opencode/main/install.sh | bash
```

That's it. The installer will:
1. Detect your OS and architecture
2. Download the pre-built `cobuilder` binary
3. Install to `~/.local/bin/`
4. Launch interactive onboarding to connect your first AI provider

> **Windows**: Run in Git Bash or WSL. PowerShell support coming soon.

### Custom install path

```bash
COBUILDER_INSTALL_DIR=/usr/local/bin curl -fsSL https://raw.githubusercontent.com/CobuilderLabs/opencode/main/install.sh | bash
```

---

## Onboarding

After install, `cobuilder onboard` walks you through provider setup interactively:

```
$ cobuilder onboard

  ╭───────────────────────────────╮
  │  Welcome to CoBuilder         │
  ╰───────────────────────────────╯

? Which provider would you like to use?
  ❯ 9Router   — Local OpenAI-compatible proxy
    Anthropic — Claude models via API key
    OpenAI    — GPT models via API key
    OpenRouter — Many providers via one API key
    Google    — Gemini models via API key
```

Run it again at any time to add more providers.

---

## Features

### Core

| Feature | Description |
|---|---|
| **Multi-provider** | Anthropic, OpenAI, OpenRouter, Google, or any OpenAI-compatible endpoint (9Router) |
| **TUI + Web UI** | Terminal-first interface plus optional browser UI (`cobuilder web`) |
| **LSP integration** | Real-time diagnostics from your language server piped into context |
| **Client/server** | Run on a remote machine, drive from anywhere (`cobuilder serve`) |
| **Built-in agents** | `build` (full access) and `plan` (read-only) — switch with `Tab` |
| **MCP support** | Connect any Model Context Protocol server |
| **Shell completion** | `cobuilder completion` for bash/zsh/fish |

### Enterprise Additions

| Feature | Description |
|---|---|
| **Cross-session memory** | Sessions are summarized and stored in a local FTS5 index. Relevant context is injected automatically at the start of each session. |
| **Crash recovery** | Auto-dream pattern: if the server exits unexpectedly, `cobuilder` prompts to resume your exact session on next launch. |
| **SSRF protection** | All provider URLs validated — blocks cloud metadata endpoints, private IP ranges, and localhost (configurable). |
| **Prompt injection detection** | Scans incoming content for override/jailbreak/exfiltration patterns before processing. |
| **Path traversal prevention** | All file operations canonicalized and base-escaped paths rejected. |
| **Rate limiting** | Per-key token-bucket rate limiter available for server mode. |
| **Audit log** | Append-only SHA-256 chained audit trail of all sensitive actions. |
| **Security headers** | CSP, HSTS, X-Frame-Options, X-Content-Type-Options on all HTTP responses. |

---

## Supported Providers

| Provider | Type | Notes |
|---|---|---|
| **9Router** | OpenAI-compatible proxy | Local, no cloud required. Ideal for enterprise air-gap. |
| **Anthropic** | API key | Claude 3.5/4 Sonnet, Haiku, Opus |
| **OpenAI** | API key | GPT-4o, o1, o3 |
| **OpenRouter** | API key | 200+ models via one key |
| **Google** | API key | Gemini 2.0, 2.5 |
| **Custom** | OpenAI-compatible | Any local/private endpoint |

---

## Platform Support

Pre-built binaries ship for every platform:

| Platform | Architecture | Variant |
|---|---|---|
| Linux | x64 | glibc / musl |
| Linux | arm64 | glibc / musl |
| macOS | arm64 (Apple Silicon) | — |
| macOS | x64 (Intel) | — |
| Windows | x64 | — |
| Windows | arm64 | — |
| Any | x64 | `baseline` (no AVX2) |

---

## Usage

```bash
# Start the TUI (default)
cobuilder

# Resume last session (auto-suggested on crash)
cobuilder run --session <id>

# Run a single prompt non-interactively
cobuilder run "refactor this file to use async/await"

# Start the web server
cobuilder web

# List available models
cobuilder models

# Manage providers
cobuilder providers

# Debug session
cobuilder debug

# Export/import sessions
cobuilder export
cobuilder import

# Shell completion
cobuilder completion >> ~/.bashrc
```

### Keyboard Shortcuts (TUI)

| Key | Action |
|---|---|
| `Tab` | Switch between agents (build / plan) |
| `Ctrl+C` | Cancel current operation |
| `Ctrl+L` | Clear screen |
| `/` | Open command palette |
| `Esc` | Back / cancel |

---

## Configuration

CoBuilder stores config at `~/.config/opencode/opencode.json`.

```jsonc
{
  "model": "anthropic/claude-sonnet-4-5",
  "provider": {
    "anthropic": { /* auto-populated by onboard */ }
  },
  // Restrict which providers are active
  "enabled_providers": ["anthropic", "openai"]
}
```

### 9Router (local proxy)

```jsonc
{
  "model": "9router/my-model",
  "provider": {
    "9router": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "9Router",
      "options": {
        "baseURL": "http://localhost:20123/v1",
        "apiKey": "9router"
      },
      "models": {
        "my-model": { "name": "my-model" }
      }
    }
  }
}
```

---

## Development

### Prerequisites

- [Bun](https://bun.sh) >= 1.3.11
- Node.js >= 18 (for some tooling)

### Setup

```bash
git clone https://github.com/CobuilderLabs/opencode.git
cd opencode
bun install

# Run from source (TUI)
bun run opencode

# Interactive onboarding
bun run onboard

# Build binaries for current platform
cd packages/opencode
bun run build --single
```

### Project Structure

```
packages/
  opencode/      # CLI + server (TypeScript/Bun)
    src/
      cli/       # Commands (run, serve, web, onboard, ...)
      session/   # Session management + checkpoint (crash recovery)
      memory/    # Cross-session memory (FTS5 store, inject, summarize)
      security/  # SSRF, path traversal, prompt injection, audit log
      provider/  # AI provider adapters
      storage/   # SQLite DB + migrations
  app/           # Web UI (SolidJS)
  console/       # Console app
```

### Running Tests

```bash
bun test
```

### Type Check

```bash
bun run typecheck
```

---

## CI/CD

CoBuilder uses GitHub Actions with trunk-based development:

| Workflow | Trigger | Jobs |
|---|---|---|
| **CI** | Pull request to `main` | Typecheck, Lint, Unit tests, Dependency audit, Secret scan (TruffleHog), SAST (CodeQL) |
| **CD** | Push to `main` | Auto-version (semver from conventional commits), GitHub Release, Multi-platform binaries |
| **Upstream sync** | Weekly (Mon 06:00 UTC) | Pulls latest from `anomalyco/opencode` → `dev` branch; opens PR on conflicts |

### Branching

```
main      ← trunk (protected, squash merges only)
dev       ← upstream sync buffer (anomalyco/opencode → here first)
feature/* ← short-lived feature branches (delete after merge)
```

### Versioning

Releases follow [Conventional Commits](https://www.conventionalcommits.org/) → [Semantic Versioning](https://semver.org/):

| Commit prefix | Version bump |
|---|---|
| `feat:` | minor |
| `fix:`, `chore:`, etc. | patch |
| `feat!:` or `BREAKING CHANGE` | major |

Release tags use the `cb-v` prefix (`cb-v0.1.0`) to avoid collisions with upstream opencode tags.

---

## Security

CoBuilder follows responsible disclosure. Please report vulnerabilities to **security@cobuilder.dev**.

We commit to acknowledging reports within 48 hours. See [SECURITY.md](SECURITY.md) for the full policy.

### Security architecture

- **SSRF protection** — provider URL validation with blocklist for cloud metadata and private IPs
- **Prompt injection scanning** — pattern-based detection before processing external content
- **Path traversal prevention** — canonicalized paths, base-escape detection
- **Audit log** — SHA-256 chained append-only log
- **Rate limiting** — token-bucket per-key limiter
- **Security headers** — CSP, HSTS, X-Frame-Options on all HTTP endpoints
- **Secret scanning** — TruffleHog runs on every PR (verified secrets only)
- **SAST** — CodeQL analysis on every PR
- **Dependency audit** — `bun audit` on every PR

---

## Enterprise Deployment

CoBuilder is designed for teams that need:

- **Air-gap compatibility** — use 9Router as a local proxy; no external calls required
- **Audit trail** — append-only chained log of all AI actions
- **Data locality** — sessions, memory, and checkpoints stored locally in SQLite
- **Provider flexibility** — switch or mix providers without changing workflows
- **Crash resilience** — auto-dream recovery means no lost sessions
- **Self-hosted binaries** — build your own from source; no package registry dependency

For enterprise support or custom deployments, open an issue or reach out directly.

---

## Contributing

1. Fork the repo and create a `feature/your-feature` branch
2. Make your changes with [Conventional Commit](https://www.conventionalcommits.org/) messages
3. Open a pull request to `main`
4. CI must pass (typecheck + secret scan + SAST)

See [CONTRIBUTING.md](CONTRIBUTING.md) for more detail.

---

## Upstream

CoBuilder is a fork of [anomalyco/opencode](https://github.com/anomalyco/opencode). Upstream improvements are synced weekly to the `dev` branch and merged to `main` after review. CoBuilder is not affiliated with the opencode team.

---

## License

[MIT](LICENSE) — CoBuilder is free and open source.
