# Claxedo ↔ Upstream Sync Guide

This document tracks how this fork is kept in sync with `upstream/dev`, and records our **intentional deviations** from upstream so future rebases can be resolved consistently.

## Version Table

| Claxedo Version | Upstream Commit | Last Sync Date |
|----------------|-----------------|----------------|
| dev | d1f5b9e91 | 2026-02-10 |
| dev | d116c227e | 2026-02-03 |

## Upstream Modifications Registry

When rebasing `fork/dev` onto `upstream/dev`, use this table to decide conflict resolution.

| Path | Why we modify | Merge strategy |
|------|---------------|----------------|
| `.github/workflows/beta.yml` | Disable scheduled runs on the fork | Keep ours |
| `.github/workflows/close-stale-prs.yml` | Disable scheduled runs on the fork | Keep ours |
| `.github/workflows/daily-issues-recap.yml` | Disable scheduled runs on the fork | Keep ours |
| `.github/workflows/daily-pr-recap.yml` | Disable scheduled runs on the fork | Keep ours |
| `.github/workflows/docs-update.yml` | Disable scheduled runs on the fork | Keep ours |
| `.github/workflows/stale-issues.yml` | Disable scheduled runs on the fork | Keep ours |
| `.github/workflows/stats.yml` | Disable scheduled runs on the fork | Keep ours |
| `packages/opencode/script/build.ts` | Allow offline dev builds by using `MODELS_DEV_API_JSON` or local fixture instead of fetching `models.dev` | Keep ours |
| `packages/desktop/scripts/predev.ts` | Desktop dev should build sidecar with cached models data (no network) | Keep ours |
| `packages/desktop/src-tauri/src/perf.rs` | Support `TAURI_ENV_OC_PERF*` env passthrough in `tauri dev` | Keep ours |
| `packages/desktop/src/perf.ts` | Ensure frontend perf timestamps reach Rust (`atMs` + `at_ms`) | Keep ours |
| `packages/desktop/src-tauri/src/cli.rs` | Avoid slow interactive shell startup (`-i`) when running the sidecar | Keep ours |
| `packages/app/src/app.tsx` | Claxedo extension system wiring | Merge carefully |
| `packages/opencode/src/pty/escape-filter.ts` | Detect clear-scrollback sequences (new file, for upstream PR) | Keep ours |
| `packages/opencode/src/pty/index.ts` | Upstream manages this; we do NOT modify it | Accept upstream |
| `packages/opencode/src/server/routes/pty.ts` | Upstream manages this; we do NOT modify it | Accept upstream |

## Notes

- `packages/claxedo-app/**` and `packages/app-shared/**` are Claxedo-owned; keep ours on conflicts.
- Lockfiles: accept upstream during rebase, then regenerate with `bun install` once the rebase finishes.
