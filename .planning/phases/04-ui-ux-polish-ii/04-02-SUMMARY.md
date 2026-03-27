---
phase: 04-ui-ux-polish-ii
plan: 02
subsystem: ui
tags: [first-run, onboarding, tui, web, i18n]
dependency_graph:
  requires: []
  provides: [first-run-guidance-tui, first-run-guidance-web]
  affects: [packages/opencode/src/cli/cmd/tui/routes/home.tsx, packages/app/src/pages/home.tsx]
tech_stack:
  added: []
  patterns: [conditional-show, isFirstTimeUser-memo, i18n-t]
key_files:
  created: []
  modified:
    - packages/opencode/src/cli/cmd/tui/routes/home.tsx
    - packages/app/src/pages/home.tsx
    - packages/app/src/i18n/en.ts
    - packages/app/src/i18n/es.ts
    - packages/app/src/i18n/zh.ts
    - packages/app/src/i18n/zht.ts
    - packages/app/src/i18n/no.ts
decisions:
  - Pre-existing typecheck errors in es.ts (duplicate keys) and app.tsx (HttpBase type) are out-of-scope; deferred
metrics:
  duration: ~8 minutes
  completed: 2026-03-26
  tasks_completed: 2
  files_modified: 7
---

# Phase 04 Plan 02: First-Run Guidance Summary

**One-liner:** Contextual onboarding hints added to TUI (3-bullet Show block) and Web (numbered Getting Started panel) for zero-session/zero-project users, with i18n across 5 locales.

## Tasks Completed

| # | Name | Commit | Files |
|---|------|--------|-------|
| 1 | Add first-run hint block to TUI home screen | 2d004c7 | packages/opencode/src/cli/cmd/tui/routes/home.tsx |
| 2 | Add Getting Started panel to Web home screen | 4c872e1 | packages/app/src/pages/home.tsx, i18n/en.ts, es.ts, zh.ts, zht.ts, no.ts |

## What Was Built

**TUI:** A `<Show when={isFirstTimeUser()}>` block inserted between the Prompt box and the Tips box. Shows 3 actionable hints using `theme.primary` bullet markers (">" character). Disappears once user has any sessions. Existing Tips component untouched.

**Web:** Replaced the minimal empty state (icon + title + description + button) with a numbered 3-step Getting Started panel. Step numbers rendered as rounded circles with `bg-surface-raised-base`. All text uses `language.t()` i18n lookups.

**i18n:** Added `home.gettingStarted.{title,step1,step2,step3}` to en, es, zh, zht, no locale files.

## Deviations from Plan

None — plan executed exactly as written.

## Deferred Issues

Pre-existing typecheck errors found (out-of-scope, not caused by this plan):
- `packages/app/src/i18n/es.ts` lines 883-885: duplicate keys `app.server.retryElapsed`, `app.server.hint.serve`, `app.server.hint.url` (pre-existing)
- `packages/app/src/app.tsx` line 289: `HttpBase` not assignable to `string | number | boolean` (pre-existing)

## Known Stubs

None — all i18n keys are wired and rendered.

## Self-Check: PASSED

- `packages/opencode/src/cli/cmd/tui/routes/home.tsx` — contains "Type a message to start a new session" and "command palette"
- `packages/app/src/pages/home.tsx` — contains "home.gettingStarted.title"
- `packages/app/src/i18n/en.ts` — contains "home.gettingStarted.title" and "home.gettingStarted.step3"
- Commit 2d004c7 exists (TUI task)
- Commit 4c872e1 exists (Web task)
