---
phase: 04-ui-ux-polish-ii
plan: "03"
subsystem: tui
tags: [update-flow, ux, background-download, toast, badge]
dependency_graph:
  requires: []
  provides: [background-update-download, persistent-update-badge]
  affects: [packages/opencode/src/cli/cmd/tui/app.tsx]
tech_stack:
  added: []
  patterns: [createSignal for pending state, Show for conditional badge, toast for non-blocking notifications]
key_files:
  created: []
  modified:
    - packages/opencode/src/cli/cmd/tui/app.tsx
decisions:
  - Background upgrade via sdk.client.global.upgrade replaces confirm-dialog flow; exit() removed
  - pendingUpdate signal drives persistent badge at top of app
  - Both DialogAlert and DialogConfirm imports removed (no remaining callers)
metrics:
  duration: "5m"
  completed: "2026-03-26"
  tasks_completed: 2
  files_modified: 1
---

# Phase 4 Plan 03: Non-Disruptive Background Update Flow Summary

**One-liner:** Silent background update download with persistent "restart to apply" badge replacing the confirm-dialog-then-force-exit pattern.

## What Was Built

The old update flow showed a confirm dialog, downloaded, then called `exit()` to force-quit the app. This was hostile UX — it interrupted work and terminated the session without warning.

The new flow:
1. On `installation.update-available` event: skip dialog, show a brief "Downloading..." toast, call `sdk.client.global.upgrade()` in background.
2. On success: set `pendingUpdate` signal with the new version string, show a 10s "ready — restart to apply" toast.
3. A `<Show when={pendingUpdate()}>` badge renders persistently at the top of the app in `theme.primary` color.
4. On failure: show a warning toast. No exit. No crash.
5. `exit()` is never called — the user quits naturally when ready.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Background download + persistent badge | 08da8dd | app.tsx |
| 2 | Remove unused imports + typecheck | 42c0e3b | app.tsx |

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Self-Check: PASSED

- `grep "pendingUpdate" packages/opencode/src/cli/cmd/tui/app.tsx` — found (signal + badge)
- `grep "restart to apply" packages/opencode/src/cli/cmd/tui/app.tsx` — found
- Commits 08da8dd and 42c0e3b exist
- TypeScript compiles cleanly (tsgo --noEmit exits 0)
