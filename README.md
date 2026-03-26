<p align="center">
  <img src="assets/logo.svg" alt="CoBuilder" width="420" />
</p>

<p align="center">The open source AI coding agent — built for teams and enterprise.</p>

<p align="center">
  <a href="https://github.com/CobuilderLabs/opencode/releases/latest"><img alt="Latest Release" src="https://img.shields.io/github/v/release/CobuilderLabs/opencode?filter=cb-v*&style=flat-square&label=release&color=0f6" /></a>
  <a href="https://github.com/CobuilderLabs/opencode/actions/workflows/cd.yml"><img alt="Build" src="https://img.shields.io/github/actions/workflow/status/CobuilderLabs/opencode/cd.yml?style=flat-square&branch=main&label=build" /></a>
  <a href="https://github.com/CobuilderLabs/opencode/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/CobuilderLabs/opencode/ci.yml?style=flat-square&label=CI" /></a>
  <a href="LICENSE"><img alt="MIT" src="https://img.shields.io/github/license/CobuilderLabs/opencode?style=flat-square" /></a>
</p>

---

CoBuilder is a fork of [opencode](https://github.com/anomalyco/opencode) that adds what teams actually need in production: **security hardening**, **cross-session AI memory**, **crash recovery**, and **guided provider onboarding** — while staying fully open source and provider-agnostic.

---

## Installation

```bash
curl -fsSL https://raw.githubusercontent.com/CobuilderLabs/opencode/main/install.sh | bash
```

The installer detects your OS and architecture, downloads the right pre-built binary, places it in `~/.local/bin/`, and launches interactive onboarding. No Node.js, no npm, no dependencies.

**Install to a custom path:**
```bash
COBUILDER_INSTALL_DIR=/usr/local/bin curl -fsSL https://raw.githubusercontent.com/CobuilderLabs/opencode/main/install.sh | bash
```

> **Windows:** Run in Git Bash or WSL.

---

## Getting Started

When you run `cobuilder onboard` for the first time (or after install), you'll be walked through connecting an AI provider:

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

Select a provider, enter your API key (or URL for local proxies), and you're done. Run `cobuilder onboard` again at any time to add more providers.

Once configured, start coding:

```bash
cobuilder          # open the TUI
cobuilder run "explain this codebase"  # non-interactive
cobuilder web      # open in browser
```

---

## AI Providers

CoBuilder works with any of the following out of the box. You are never locked in to one.

**9Router** — a local OpenAI-compatible proxy you run yourself. No data leaves your machine. Ideal for air-gapped or regulated environments. During onboarding, CoBuilder connects to your 9Router instance, fetches the available models, and lets you pick which ones to activate.

**Anthropic** — Claude 3.5 Sonnet, Claude 3 Haiku, Claude Opus. Best-in-class reasoning and code generation. Requires an Anthropic API key.

**OpenAI** — GPT-4o, o1, o3-mini and the full OpenAI model lineup. Requires an OpenAI API key.

**OpenRouter** — a single API key that routes to 200+ models from Anthropic, OpenAI, Meta, Mistral, and others. Good for teams that want to compare models or manage cost centrally.

**Google** — Gemini 2.0 Flash, Gemini 2.5 Pro. Requires a Google AI API key.

**Custom endpoint** — any server that speaks the OpenAI API format works. Point CoBuilder at it via 9Router or configure it directly in `opencode.json`.

---

## Features

### Terminal-first interface

CoBuilder opens a full terminal UI with syntax-highlighted output, streaming responses, and keyboard-driven navigation. Switch between the `build` agent (full file access) and the `plan` agent (read-only analysis) with `Tab`. Press `/` to open the command palette.

### Cross-session memory

At the end of each session, CoBuilder summarizes what happened — files touched, commands run, decisions made — and stores it in a local full-text search index. On your next session, it searches that history for relevant context and quietly injects it into the system prompt. Your agent remembers your project's history without you having to re-explain it.

### Crash recovery

If the CoBuilder server exits unexpectedly, the next launch detects the interrupted session and offers to resume it exactly where it left off. No work is lost. This uses a checkpoint written at each user turn — lightweight, fast, and stored locally.

### LSP integration

Language server diagnostics (errors, warnings, type information) flow directly into the AI's context window. The agent sees the same problems your editor sees, in real time.

### Client/server architecture

`cobuilder serve` starts a local API server. The TUI and web UI are both clients — meaning you can run CoBuilder on a remote machine and drive it from your laptop, a browser, or a custom client.

### MCP support

Connect any [Model Context Protocol](https://modelcontextprotocol.io) server to extend CoBuilder with external tools, data sources, or APIs. Use `cobuilder mcp` to manage connections.

---

## Security

CoBuilder is designed to be safe to run in team and enterprise environments. Here's what's built in.

**SSRF protection** — When you configure a custom provider URL, CoBuilder validates it before making any network requests. It rejects URLs that point to cloud instance metadata endpoints (AWS `169.254.169.254`, GCP, Azure equivalents), private RFC-1918 address ranges, and localhost — unless you've explicitly allowed them. This prevents a misconfigured or malicious provider URL from being used to exfiltrate internal infrastructure data.

**Prompt injection detection** — Content pulled from files, web pages, or external tools is scanned for patterns commonly used in prompt injection attacks: instructions that try to override the system prompt, commands that attempt to exfiltrate data, jailbreak templates, and shell injection sequences. Detections are logged before any content reaches the model.

**Path traversal prevention** — Every file path is canonicalized and checked against the allowed base directory before the file is read or written. Paths containing `../` sequences, symlink escapes, or null bytes are rejected outright. The agent cannot be tricked into reading files outside the project.

**Audit log** — All sensitive operations — file writes, shell commands, provider calls — are recorded in an append-only log. Each entry is SHA-256 chained to the previous one, so the log cannot be silently tampered with or truncated.

**Rate limiting** — In server mode, per-client token-bucket rate limiting prevents any single client from overwhelming the server or burning through API quota unexpectedly.

**Security headers** — All HTTP responses from `cobuilder serve` and `cobuilder web` include `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, and `Referrer-Policy: no-referrer`.

**Supply chain** — Every pull request runs TruffleHog (verified secret scanning), CodeQL static analysis, and a dependency audit. No secrets can be merged accidentally, and known-vulnerable packages are flagged before they ship.

To report a vulnerability, email **security@cobuilder.dev**. We acknowledge within 48 hours. See [SECURITY.md](SECURITY.md) for the full disclosure policy.

---

## Enterprise Deployment

**Air-gap ready.** Use 9Router as your local model proxy. Once configured, CoBuilder makes no external network requests — all AI inference stays inside your network.

**Data stays local.** Sessions, cross-session memory, checkpoints, and audit logs are all stored in SQLite on the local filesystem. Nothing is sent to a CoBuilder service or cloud.

**No registry dependency.** Pre-built binaries are published directly to GitHub Releases. You can mirror them internally and point your install script there. Alternatively, build from source — it's a single `bun run build` command.

**Bring your own provider contracts.** If your company has negotiated API pricing with Anthropic, OpenAI, or others, CoBuilder works with those keys directly. No middleman.

**Crash resilience.** The checkpoint system means an unexpected server restart doesn't lose in-progress sessions. Engineers pick up where they left off.

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
    "anthropic": {}
  }
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
        "apiKey": "9router"
      },
      "models": {
        "llama-3.1-70b": { "name": "llama-3.1-70b" }
      }
    }
  }
}
```

---

## Platform Support

Pre-built binaries are available for every major platform. The install script picks the right one automatically.

- **Linux** — x64 and arm64, glibc and musl (Alpine/Docker), with AVX2-free baseline variants
- **macOS** — Apple Silicon (arm64) and Intel (x64)
- **Windows** — x64 and arm64

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
bun test                 # unit tests
bun run typecheck        # TypeScript
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
