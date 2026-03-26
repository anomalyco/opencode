# CoBuilder — Project State

**Last updated:** 2026-03-26
**Current phase:** Phase 3 — UI/UX Polish
**Stopped at:** Phase 3 Plan 3 complete — 03-03-SUMMARY.md written, branch feat/phase3-ui-ux-polish

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-03-26)

**Core value:** A coding agent that teams can actually trust in production — secure by default, provider-flexible, and extensible with team workflows.
**Current focus:** Phase 3 — UI/UX Polish

## Phase Status

| Phase | Name | Status |
|-------|------|--------|
| 1 | Modular Security System | ✅ Complete — PR #10 open |
| 2 | Workflow Plugin System | ✅ Complete |
| 3 | UI/UX Polish | 🔄 In progress — Plan 3 complete |

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
| 2026-03-26 | onMount once-guard removed (UX-13) | onMount runs once per mount — module-level flag was redundant |
| 2026-03-26 | footer /connect hint made reactive (UX-11) | createEffect replaces timer cycling — deterministic visibility |
| 2026-03-26 | __OPENCODE__ renamed to __COBUILDER__ across all 8 referencing files | Consistent global rename; plan only specified 2 files but grep found 8 |
| 2026-03-26 | Electron menu cross-platform via isMac conditional (UX-03) | darwin: app submenu + hide roles; Win/Linux: Quit in File, Check for Updates in Help |
| 2026-03-26 | createEffect one-shot gate for onboarding check (UX-04) | checked flag prevents re-firing; replaces 800ms setTimeout race |
| 2026-03-26 | No-provider banner above SessionComposerRegion (UX-05) | banner placed above, not instead of, composer so structure is preserved |
| 2026-03-26 | Inline SVG spinner for composer loading (UX-06) | avoids unknown UI component dependency; animate-spin Tailwind class |
| 2026-03-26 | group+group-hover drag handle on SortableTab (UX-09) | opacity-0/group-hover:opacity-40 for unobtrusive progressive disclosure |
