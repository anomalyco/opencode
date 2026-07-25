# Spec: Upstream Sync Analysis & Planning

## Motivation

This fork of OpenCode tracks `anomalyco/opencode` on the `dev` branch with a 500–700 commit gap. Each sync is manual and error-prone. Custom changes (token cache_write, SSE usage injection, HTTP/1.1 upstream, llama-skein mDNS, local LAN discovery, TUI customizations) risk being silently overwritten. There is no automated divergence analysis, no tagging discipline helper, and no consolidated reference document.

## Goals

1. Produce a **complete, machine-checkable catalog** of every custom change with file paths, purposes, and re-application procedures.
2. Produce a **machine-generated divergence report** that maps which files differ from upstream and classifies each as `custom-only`, `upstream-modified`, or `both`.
3. Create **repeatable tooling**: `script/analyze-divergence.ts` for divergence analysis and `script/tag-upstream.sh` for tagging discipline.
4. Write a **consolidated reference document** (`docs/UPSTREAM_SYNC.md`) that serves as the single source of truth for the fork strategy.
5. Document the **Skein port update procedure** to enforce the one-way dependency chain (upstream → fork → tag → skein).

## Requirements

### R1: Custom-Change Catalog

The catalog must list every local modification with:
- File path (relative to repo root)
- Area / category (e.g., "Token cache_write", "Local mDNS discovery")
- Description of the change
- Upstream divergence point (commit range or "no upstream change")
- Conflict risk (low / medium / high)
- Re-application procedure (step-by-step)

Source: `FORK_WORKFLOW.md` § Custom Changes to Preserve, cross-referenced with `git log`.

### R2: Divergence Analysis

- `script/analyze-divergence.ts` must accept `--json` or `--markdown` flags and output a structured report.
- The report classifies each diverged file by checking `git log` history against `upstream/dev`.
- Output must include at minimum: file path, classification, last upstream commit, last fork commit.

### R3: Tagging Helper

- `script/tag-upstream.sh` must tag the current `dev` commit with `fork/YYYY-MM-DD.N`.
- Must auto-increment `N` when a same-day tag already exists.
- Must support `--dry-run` mode.
- Must push the tag to origin (unless `--no-push`).

### R4: Sync Procedure

The procedure in `docs/UPSTREAM_SYNC.md` must cover:
1. Pre-checks (fetch origin/upstream, clean worktrees)
2. Dry-run inspection (`bun script/sync-upstream.ts`)
3. Execution (`bun script/sync-upstream.ts --apply`)
4. Validation commands (typecheck, build, smoke test)
5. Conflict resolution guidance
6. Merge-back to `dev`
7. Tagging
8. Worktree cleanup

### R5: Validation Test Plan

The test plan must include specific commands and expected outcomes:
- `bun typecheck` — exits 0
- `bun build` — exits 0
- `opencode --version` — prints version string
- Provider discovery checks (mDNS, LAN scan)

### R6: Skein Port Update Procedure

Must document:
- How to identify the tagged fork snapshot
- How to update Go module references in skein
- How to verify the build
- Commit message convention

### R7: Consolidated Reference Document

`docs/UPSTREAM_SYNC.md` must contain all of the above as sections, cross-linking to individual spec files in `specs/initial/`.

## Non-Goals

- Implementing the enhanced sync script (covered by `sustainable-upstream-sync` change).
- Merging specific upstream commits.
- Changes to Skein, beads, llama-swap, or llama-skein repositories.
- Automating conflict resolution.

## File Layout

```
openspec/changes/intake-20260601-013404-ebed80/
├── proposal.md          (already exists)
├── tasks.md             (new)
├── specs/
│   └── initial/
│       ├── spec.md                     (this file)
│       ├── divergence-files.txt        (new, analysis artifact)
│       ├── divergence-classification.md (new)
│       ├── divergence-report.json      (new, analysis artifact)
│       ├── reapplication-procedures.md (new)
│       ├── sync-procedure.md           (new)
│       ├── test-plan.md                (new)
│       └── skein-port-update.md        (new)
├── script/
│   ├── analyze-divergence.ts     (new)
│   └── tag-upstream.sh           (new)
└── docs/
    └── UPSTREAM_SYNC.md            (new)
```

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Incomplete catalog | Cross-reference FORK_WORKFLOW.md, AGENTS.md, and git log |
| Stale divergence data | Make `analyze-divergence.ts` the source of truth (repeatable) |
| Scope creep into implementation | Tasks are analysis/documentation only; tooling is thin wrappers |
| Fork workflow drift | `docs/UPSTREAM_SYNC.md` is the canonical reference; FORK_WORKFLOW.md delegates to it |
