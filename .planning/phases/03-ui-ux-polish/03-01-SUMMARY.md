---
phase: 03-ui-ux-polish
plan: 01
subsystem: tui, electron
tags: [ux, polish, tips, loading, footer, debug-cleanup]
dependency_graph:
  requires: []
  provides: [ux-tips-logic, ux-loading-screen, ux-footer-hint]
  affects: [tui-home, tui-footer, electron-loading]
tech_stack:
  added: []
  patterns: [solidjs-createEffect-reactive, onMount-scoped]
key_files:
  created: []
  modified:
    - packages/opencode/src/cli/cmd/tui/routes/home.tsx
    - packages/opencode/src/cli/cmd/tui/app.tsx
    - packages/opencode/src/cli/cmd/tui/routes/session/footer.tsx
    - packages/desktop-electron/src/renderer/loading.tsx
decisions:
  - "onMount once-guard replaced by removing module-level flag; onMount runs once per component mount so guard was redundant"
  - "footer /connect hint made always-visible-when-disconnected via createEffect instead of timer cycling"
metrics:
  duration: ~10m
  completed: 2026-03-26
  tasks_completed: 2
  files_modified: 4
---

# Phase 3 Plan 1: UI/UX Quick Wins Summary

**One-liner:** Fixed 6 isolated UI/UX issues — inverted tips logic for first-time users, removed debug log, replaced module-level once-guard with proper SolidJS pattern, made footer /connect hint persistent, changed Electron loading bar to accent color, added CoBuilder product name.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Fix TUI home tips, debug log, and TODO hack | b194c2d | home.tsx, app.tsx |
| 2 | Fix Electron loading bar color, product name, footer hint | 3ce9b7b | loading.tsx, footer.tsx |

## Requirements Resolved

| ID | Description | Verification |
|----|-------------|--------------|
| UX-02 | Tips shown to first-time users | `grep "isFirstTimeUser.*return true" home.tsx` matches |
| UX-07 | Loading bar uses accent color | `grep "bg-accent-base" loading.tsx` matches |
| UX-10 | Debug console.log removed | `grep "console.log.*JSON.stringify.*route" app.tsx` no match |
| UX-11 | Footer /connect hint persistent, no timer | `grep "setTimeout" footer.tsx` no match |
| UX-12 | CoBuilder product name on loading screen | `grep "CoBuilder" loading.tsx` matches |
| UX-13 | No TODO hack / module-level once guard | `grep "let once = false" home.tsx` no match |

## Decisions Made

1. **onMount once-guard removal:** The `let once = false` module-level flag was intended to prevent `prompt.set()` from firing on re-renders. Since `onMount` runs exactly once per component mount in SolidJS, the guard was fully redundant. Removed the flag and TODO comment entirely.

2. **footer reactive pattern:** The timer-cycling approach (show for 5s, hide for 10s) was replaced with `createEffect(() => setStore("welcome", !connected()))`. This makes the hint deterministic and permanently visible when disconnected — no timing-dependent behavior.

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Self-Check: PASSED

- `b194c2d` exists in git log
- `3ce9b7b` exists in git log
- All 4 modified files present on disk
- All 6 grep acceptance criteria verified
