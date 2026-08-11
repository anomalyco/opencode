# Proposal: Sustainable Upstream Sync Strategy

## Context

This fork of OpenCode tracks an upstream repository on the `dev` branch. The current sync process (`script/sync-upstream.ts` + `FORK_WORKFLOW.md`) creates a worktree and merges upstream into it, but leaves much of the validation and custom-change preservation to manual effort. As the fork accumulates local features (Skein integration, beads, llama-swap patches, llama-skein), each sync becomes more error-prone and time-consuming.

## Why

Without a structured, repeatable sync strategy:
- Custom changes (token cache_write, SSE usage injection, HTTP/1.1 upstream) are at risk of being lost during merges
- Validation is manual and incomplete — typechecks, builds, and smoke tests happen ad hoc
- The Skein dependency chain (upstream → fork → tagged snapshot → skein port) has no automation to enforce tagging discipline
- Conflict resolution is unguided — no tooling identifies which files will likely conflict

## What

A comprehensive, automatable upstream sync strategy that includes:

1. **Enhanced sync script** — extends `script/sync-upstream.ts` with conflict detection, pre-merge analysis, and post-merge validation hooks
2. **Custom change preservation guide** — documents each custom change with exact file locations, diff context, and re-application steps
3. **Validation checklist** — automated checks for typecheck, build, and smoke test in the sync worktree
4. **Tagging discipline** — enforces the upstream → fork → tagged snapshot → skein port dependency chain
5. **Updated FORK_WORKFLOW.md** — consolidates all sync procedures into a single authoritative reference

## Scope

- **In scope**:
  - Enhance `script/sync-upstream.ts` with conflict analysis and validation hooks
  - Expand `FORK_WORKFLOW.md` with full custom-change catalog and re-application procedures
  - Add a validation script (`script/sync-validate.ts`) for the sync worktree
  - Document the Skein port chain enforcement procedure
  - Add a GitHub Action or pre-commit hook for sync readiness checks

- **Out of scope**:
  - Merging specific upstream commits (that is an operational use of this strategy)
  - Changes to Skein, beads, llama-swap, or llama-skein repositories themselves
  - Automating the actual conflict resolution (we document the process, not auto-fix)

## Risks

- **Scope creep** — mitigated by keeping tasks focused on documentation and lightweight tooling
- **Script complexity** — the sync script could become fragile; mitigated by keeping it simple and well-tested
- **Stale custom-change docs** — mitigated by including custom-change docs as part of the sync validation checklist
