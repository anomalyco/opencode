# CoBuilder

## What This Is

CoBuilder is an open-source AI coding agent built for teams and enterprise. It is a TypeScript/Bun fork of anomalyco/opencode that adds security hardening, cross-session AI memory, crash recovery, and guided provider onboarding — while remaining fully open source and provider-agnostic.

## Core Value

A coding agent that teams can actually trust in production — secure by default, provider-flexible, and extensible with team workflows.

## Requirements

### Validated

- ✓ SSRF protection, prompt injection detection, path traversal prevention, audit log, rate limiting, security headers — Phase 0 (shipped)
- ✓ Cross-session memory (FTS5 SQLite index) — Phase 0 (shipped)
- ✓ Crash recovery via session checkpoints — Phase 0 (shipped)
- ✓ Guided provider onboarding (9Router, Anthropic, OpenAI, OpenRouter, Google, GitHub Copilot) — Phase 0 (shipped)
- ✓ CI/CD pipeline (typecheck, lint, audit, secret scan, SAST, unit tests) — Phase 0 (shipped)
- ✓ Branch protection (trunk-based, squash merge, auto-delete) — Phase 0 (shipped)

### Active

- [ ] Modular security system — each security module configurable via opencode.json
- [ ] Workflow plugin system — install methodology plugins (GSD, Ralph Loop, GStack) as first-class CoBuilder extensions

### Out of Scope

- Rewrite in Rust — attempted, failed catastrophically. TypeScript/Bun only.
- Rewrite in Go — on hold, user restarted with fresh TypeScript fork. Confirm before revisiting.
- Cloud-hosted CoBuilder service — data stays local by design.

## Context

- **Stack**: TypeScript + Bun, monorepo under `packages/opencode/` (CLI/server) and `packages/app/` (SolidJS web UI)
- **Upstream**: Forks from anomalyco/opencode, weekly automated sync via `dev` branch. Our tag prefix `cb-v` keeps versions independent.
- **Security modules**: 6 hardcoded modules in `packages/opencode/src/security/` — ssrf.ts, prompt-injection.ts, path.ts, rate-limiter.ts, audit.ts, headers.ts
- **Plugin system**: Exists at `packages/opencode/src/plugin/` — copilot.ts is the primary example. MCP support already integrated.
- **Provider onboarding**: `packages/opencode/src/cli/cmd/onboard.ts` — interactive wizard that writes `~/.config/opencode/opencode.json`
- **GitHub Copilot**: Full Device Code OAuth flow, supports GitHub.com and GitHub Enterprise

## Constraints

- **Tech stack**: TypeScript + Bun only — no Rust, no Go rewrites
- **Backwards compatibility**: New features must not break existing `opencode.json` configs (security modules default to enabled)
- **Upstream sync**: Changes must survive weekly merges from anomalyco/opencode without conflicts
- **CI**: All PRs must pass Typecheck, Lint, Dependency Audit, Secret Scan, SAST, Unit Tests before merge
- **Branch policy**: NEVER commit directly to main — always branch + PR

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| TypeScript + Bun (not Rust/Go) | Rust rewrite was a disaster; Go on hold; stay with upstream language | ✓ Good |
| Fork anomalyco/opencode not sst/opencode | anomalyco is the active maintained fork | ✓ Good |
| Security modules hardcoded and always-on | Safe default for initial launch | ⚠️ Revisit — Phase 1 makes them modular |
| `cb-v` tag prefix | Independent versioning from upstream | ✓ Good |
| Squash merge only + auto-delete branch | Clean git history, trunk-based dev | ✓ Good |
| GitHub Copilot via Device Code OAuth | No API key needed, works for Business/Enterprise | ✓ Good |

---
*Last updated: 2026-03-26 after GSD project initialization*
