# Proposal: Upstream Sync Analysis & Planning

## Context

This fork of OpenCode tracks the upstream `anomalyco/opencode` `dev` branch. The current gap is 500-700 commits. The sync process (`script/sync-upstream.ts` + `FORK_WORKFLOW.md`) leaves validation and custom-change preservation to manual effort. As the fork accumulates local features (Skein integration, beads, llama-swap patches, llama-skein), each sync becomes more error-prone and time-consuming.

A companion change (`sustainable-upstream-sync`) already plans the implementation of enhanced tooling (conflict detection, validation scripts, tagging discipline). This change focuses on the **analysis and planning** phase: cataloging every custom change, mapping divergence points, and producing a repeatable sync procedure before tooling is built.

## Why

Without a thorough analysis of the current fork state:
- Custom changes (token cache_write, SSE usage injection, HTTP/1.1 upstream, llama-skein mDNS) are at risk of being lost or silently overwritten during merges
- The 500-700 commit gap makes it impossible to estimate merge effort or identify which files are conflict-prone
- The Skein dependency chain (upstream → fork → tagged snapshot → skein port) has no automation to enforce tagging discipline
- There is no documented procedure for updating Skein after an upstream merge

## What

This change produces:
1. **A complete custom-change catalog** — every local modification with file location, purpose, upstream divergence point, and re-application procedure
2. **A divergence analysis** — `git diff`-based mapping of which files have diverged and which are likely to conflict
3. **A repeatable sync procedure** — step-by-step documented workflow with pre-checks, merge steps, post-checks, and rollback procedure
4. **A test plan** — validation checks (typecheck, build, smoke test) with specific commands and expected outcomes
5. **An updated `docs/UPSTREAM_SYNC.md`** — consolidating all findings into a single authoritative reference
6. **A `docs/UPSTREAM_SYNC.md`** — the master document containing custom change catalog, sync procedure, validation checklist, tagging discipline, and Skein port update steps

## Scope

- **In scope**:
  - Analyze and catalog all custom changes across the fork
  - Map file-level divergence from upstream using git diff
  - Write a repeatable sync procedure with pre/post checks
  - Define validation test plan with specific commands
  - Create `docs/UPSTREAM_SYNC.md` as the authoritative reference
  - Create `script/tag-upstream.sh` helper for tagging discipline
  - Document the Skein port update procedure

- **Out of scope**:
  - Implementing the enhanced sync script (covered by `sustainable-upstream-sync`)
  - Merging specific upstream commits (operational use of this strategy)
  - Changes to Skein, beads, llama-swap, or llama-skein repositories themselves
  - Automating conflict resolution (we document the process, not auto-fix)

## Risks

- **Incomplete custom-change catalog** — mitigated by cross-referencing FORK_WORKFLOW.md, AGENTS.md, and git log
- **Stale divergence analysis** — mitigated by making the analysis a repeatable script (`script/analyze-divergence.ts`)
- **Scope creep into implementation** — mitigated by keeping tasks focused on analysis and documentation; tooling implementation is a separate change
