---
phase: 03-ui-ux-polish
plan: "02"
subsystem: branding
tags: [rebrand, tui, web, electron, i18n, cross-platform]
dependency_graph:
  requires: []
  provides: [cobuilder-brand-complete, cross-platform-electron-menu]
  affects: [packages/opencode/src/cli/cmd/tui, packages/app/src, packages/desktop-electron/src]
tech_stack:
  added: []
  patterns: [isMac conditional menu template, __COBUILDER__ window global]
key_files:
  created: []
  modified:
    - packages/opencode/src/cli/cmd/tui/app.tsx
    - packages/opencode/src/cli/cmd/tui/component/tips.tsx
    - packages/opencode/src/cli/cmd/tui/component/dialog-provider.tsx
    - packages/opencode/src/cli/cmd/tui/routes/session/permission.tsx
    - packages/opencode/src/cli/cmd/tui/routes/session/sidebar.tsx
    - packages/app/src/app.tsx
    - packages/app/src/pages/layout/deep-links.ts
    - packages/app/src/pages/layout/helpers.test.ts
    - packages/app/src/i18n/en.ts
    - packages/app/src/i18n/es.ts
    - packages/desktop-electron/src/main/menu.ts
    - packages/desktop-electron/src/main/windows.ts
    - packages/desktop-electron/src/renderer/env.d.ts
    - packages/desktop-electron/src/renderer/index.tsx
    - packages/desktop-electron/src/renderer/updater.ts
decisions:
  - "Replace __OPENCODE__ window global with __COBUILDER__ across all 8 files that reference it (app.tsx, deep-links.ts, helpers.test.ts, windows.ts, env.d.ts, index.tsx, updater.ts)"
  - "Cross-platform menu uses isMac conditional: darwin gets app submenu + hide/unhide roles; Win/Linux gets Quit in File and Check for Updates in Help"
  - "Issue URLs updated to CobuilderLabs org in both TUI app.tsx error reporter and Electron menu"
metrics:
  duration: "~25 minutes"
  completed: "2026-03-26"
  tasks_completed: 2
  files_modified: 15
---

# Phase 3 Plan 02: CoBuilder Full Rebrand + Cross-Platform Menu Summary

Complete rebrand of all three surfaces (TUI, Web, Electron) from OpenCode to CoBuilder, plus cross-platform Electron menu support for Windows and Linux.

## What Was Built

**TUI rebrand (5 files):** All user-visible "OpenCode" strings replaced with "CoBuilder" across the terminal UI — terminal title, update toast, issue reporter URL, tips (7 strings), dialog-provider Zen/Go descriptions, permission dialogs, and sidebar getting-started text.

**Web app rebrand (5 files):** `window.__OPENCODE__` renamed to `window.__COBUILDER__` in the global type declaration and all usages. English and Spanish i18n files fully rebranded (18 strings each) covering free models title, API key descriptions, Zen provider copy, server dialog, update toast, error report prefix, MCP error, sidebar, app name, WSL setting, and all settings descriptions.

**Electron rebrand + cross-platform menu (5 files):** Removed the `if (process.platform !== "darwin") return` early exit. New `isMac` conditional builds a unified menu template — macOS gets the CoBuilder app submenu with `hide/hideOthers/unhide` roles; Windows/Linux get `Quit` appended to File menu and `Check for Updates` + `Install CLI` in Help. All accelerators use `isMac ? "Cmd" : "Ctrl"` pattern. Issue URLs updated to CobuilderLabs org.

## Tasks

| # | Name | Commit | Status |
|---|------|--------|--------|
| 1 | Rebrand TUI | 8feb3d9 | Done |
| 2 | Rebrand Web + Electron cross-platform menu | d085af1 | Done |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing] Extended __OPENCODE__ rename to all 8 referencing files**
- **Found during:** Task 2
- **Issue:** Plan specified only `packages/app/src/app.tsx` and `packages/desktop-electron/src/` for the `__OPENCODE__` rename, but `grep` found 8 files total including `deep-links.ts`, `helpers.test.ts`, `renderer/env.d.ts`, `renderer/index.tsx`, `renderer/updater.ts`
- **Fix:** Applied `replace_all` to all 8 files so the global rename is complete and consistent
- **Files modified:** packages/app/src/pages/layout/deep-links.ts, packages/app/src/pages/layout/helpers.test.ts, packages/desktop-electron/src/renderer/env.d.ts, packages/desktop-electron/src/renderer/index.tsx, packages/desktop-electron/src/renderer/updater.ts
- **Commit:** d085af1

## Verification Results

- `grep -r "__OPENCODE__" packages/app/src/ packages/desktop-electron/src/` → CLEAN (exit 1)
- `grep "OpenCode" packages/app/src/i18n/en.ts` → 0 matches
- `grep "OpenCode" packages/app/src/i18n/es.ts` → 0 matches
- TUI files: all (clean)
- `grep "isMac" packages/desktop-electron/src/main/menu.ts` → 11 matches
- `bun run typecheck` → 13/13 tasks successful

## Known Stubs

None — all branding changes are complete string replacements with no stubs or placeholders.

## Self-Check: PASSED
