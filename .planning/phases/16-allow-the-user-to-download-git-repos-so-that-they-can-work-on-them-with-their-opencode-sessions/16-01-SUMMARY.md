---
phase: 16-allow-the-user-to-download-git-repos-so-that-they-can-work-on-them-with-their-opencode-sessions
plan: 01
subsystem: frontend
tags: [repo, clone, ui, sdk]

# Dependency graph
requires: []
provides:
  - Repo clone/selection UI in Solid app
  - Repo branch switching with dirty warning handling
  - SDK exposure for repo endpoints
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Solid hook for SSE clone progress"
    - "Repo selection and branch switching via SDK"

key-files:
  created:
    - packages/app/src/hooks/use-clone-progress.ts
    - packages/app/src/components/repo/clone-dialog.tsx
    - packages/app/src/components/repo/repo-selector.tsx
    - packages/app/src/components/repo/repo-settings-dialog.tsx
    - packages/app/src/components/repo/repository-manager-dialog.tsx
  modified:
    - packages/app/src/pages/home.tsx
    - packages/app/src/components/session/session-new-view.tsx
    - packages/sdk/openapi.json
    - packages/sdk/js/src/v2/gen/sdk.gen.ts
    - packages/sdk/js/src/v2/gen/types.gen.ts

key-decisions:
  - "Clone dialog uses SSE progress and supports credential retry"
  - "Repo selector can add local repos, clone from URL, and switch branches"
  - "Dirty working tree warnings allow a force-switch confirmation"

patterns-established:
  - "Repo actions use SDK client with toast feedback"

# Metrics
duration: 1h
completed: 2026-01-27
---

# Phase 16 Plan 01: Repo Clone UI Summary

**UI workflow now mirrors Ralphcity clone and repo management behavior in opencode.**

## Accomplishments

- Added Solid hook to handle clone progress (SSE + POST stream) and cancellation.
- Built clone dialog with branch input, progress display, and credential retry flow.
- Added repo selector for session start with local add, clone, and branch switching.
- Added repository manager dialog to list repos, open projects, and access settings.
- Added repo settings dialog to switch branches with dirty tree warnings.
- Wired home and new-session views to expose repo clone/selection UI.

## Files Created/Modified

- `packages/app/src/hooks/use-clone-progress.ts` - clone progress via SSE and POST stream parsing
- `packages/app/src/components/repo/clone-dialog.tsx` - clone UI with progress and auth retry
- `packages/app/src/components/repo/repo-selector.tsx` - repo + branch selector
- `packages/app/src/components/repo/repo-settings-dialog.tsx` - branch switch dialog with dirty warnings
- `packages/app/src/components/repo/repository-manager-dialog.tsx` - repo list/add/clone manager
- `packages/app/src/pages/home.tsx` - clone/manage repo entry points
- `packages/app/src/components/session/session-new-view.tsx` - repo selector in new session view
- `packages/sdk/openapi.json` - repo endpoints and schemas
- `packages/sdk/js/src/v2/gen/sdk.gen.ts` - generated repo client methods
- `packages/sdk/js/src/v2/gen/types.gen.ts` - generated repo types

## Test Coverage

- Not run (UI + SDK updates only).

## Deviations from Plan

- None.

---

_Phase: 16-allow-the-user-to-download-git-repos-so-that-they-can-work-on-them-with-their-opencode-sessions_
_Completed: 2026-01-27_
