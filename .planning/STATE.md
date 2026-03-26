# CoBuilder — Project State

**Last updated:** 2026-03-26
**Current phase:** Phase 2 — Workflow Plugin System
**Stopped at:** Phase 1 merged to main — Phase 2 PR #11 open

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-03-26)

**Core value:** A coding agent that teams can actually trust in production — secure by default, provider-flexible, and extensible with team workflows.
**Current focus:** Phase 1 — Modular Security System

## Phase Status

| Phase | Name | Status |
|-------|------|--------|
| 1 | Modular Security System | ✅ Complete — merged to main |
| 2 | Workflow Plugin System | 🔄 In progress — PR #11 open |

## What's Shipped (Phase 0 — already in main)

- 6 security modules: SSRF, prompt injection, path traversal, audit log, rate limiting, security headers
- Cross-session memory (FTS5 SQLite)
- Crash recovery (session checkpoints)
- Provider onboarding wizard: 9Router, Anthropic, OpenAI, OpenRouter, Google, GitHub Copilot (Device Code OAuth)
- CI/CD pipeline + branch protection
- Upstream sync from anomalyco/opencode (weekly automated)
- Jindo pixel art mascot (two-tone, in assets/logo.svg and assets/mascot.svg)

## Key Technical Facts

- **Repo**: CobuilderLabs/opencode, local at `~/cobuilder-opencode/`
- **Stack**: TypeScript + Bun, monorepo
- **Security modules**: `packages/opencode/src/security/` — 6 files, all hardcoded
- **Plugin system**: `packages/opencode/src/plugin/` — copilot.ts is the reference
- **Config file**: `~/.config/opencode/opencode.json`
- **Branch policy**: Never push to main. Feature branch → PR → squash merge → auto-delete
- **CI checks**: Typecheck, Lint, Dependency Audit, Secret Scanning, SAST (CodeQL), Unit Tests

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-26 | Stay TypeScript+Bun | Rust failed, Go on hold |
| 2026-03-26 | Security modules default enabled | Backwards compat |
| 2026-03-26 | Workflow plugins stored in ~/.config/opencode/workflows/ | Consistent with existing config location |
| 2026-03-26 | GSD ships as separate plugin, not bundled | Keeps core lean; users opt in |
| 2026-03-26 | !== false guard pattern for all security modules | Absent key = enabled (SEC-07 default-on) |
| 2026-03-26 | security Zod schema inserted before .strict() | Required for TypeScript to accept the key |
