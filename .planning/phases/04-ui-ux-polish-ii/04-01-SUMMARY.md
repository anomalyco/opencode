---
phase: 04-ui-ux-polish-ii
plan: 01
subsystem: onboarding, connection-error, i18n
tags: [ux, onboarding, i18n, solidjs, connection-error]
requirements: [UX2-02, UX2-04]
dependency_graph:
  requires: []
  provides: [step-progress-onboarding, connection-error-elapsed-timer]
  affects: [packages/opencode/src/cli/cmd/onboard.ts, packages/app/src/app.tsx, packages/app/src/i18n]
tech_stack:
  added: []
  patterns: [createSignal-elapsed-timer, createMemo-server-url-derivation]
key_files:
  created: []
  modified:
    - packages/opencode/src/cli/cmd/onboard.ts
    - packages/app/src/app.tsx
    - packages/app/src/i18n/en.ts
    - packages/app/src/i18n/es.ts
    - packages/app/src/i18n/zh.ts
    - packages/app/src/i18n/zht.ts
    - packages/app/src/i18n/no.ts
    - packages/app/src/i18n/de.ts
    - packages/app/src/i18n/fr.ts
    - packages/app/src/i18n/ja.ts
    - packages/app/src/i18n/ko.ts
    - packages/app/src/i18n/pl.ts
    - packages/app/src/i18n/ru.ts
    - packages/app/src/i18n/th.ts
    - packages/app/src/i18n/tr.ts
    - packages/app/src/i18n/ar.ts
    - packages/app/src/i18n/br.ts
    - packages/app/src/i18n/bs.ts
    - packages/app/src/i18n/da.ts
decisions:
  - "Returned current.http.url (string) not current.http (HttpBase) to satisfy i18n t() type constraint"
  - "Updated all 17 locale files (not just 4 plan-specified) to maintain parity test coverage"
metrics:
  duration: 15m
  completed: "2026-03-26"
  tasks: 2
  files: 19
---

# Phase 4 Plan 01: Onboarding Progress Indicators and ConnectionError Enhancement Summary

**One-liner:** Step N of 4 progress prefixes on onboarding wizard plus elapsed-second retry counter and contextual guidance on ConnectionError.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add step progress to onboarding wizard | 4449618 | packages/opencode/src/cli/cmd/onboard.ts |
| 2 | Enhance ConnectionError with elapsed timer and actionable guidance | df8fb50 | packages/app/src/app.tsx, packages/app/src/i18n/* (17 files) |

## What Was Built

**Task 1 — Onboarding step progress:**
- Added `prompts.log.step("Step 1 of 4 — Choose your provider")` before the provider select prompt
- Changed setupSecurity() heading to "Step 2 of 4 — Security modules"
- Changed setupWorkflows() heading to "Step 3 of 4 — Workflow plugins (optional)"
- Changed setupRecommendedTools() heading to "Step 4 of 4 — Recommended tools (optional)"

**Task 2 — ConnectionError elapsed timer and guidance:**
- Added `elapsedSeconds` signal incremented every second inside the existing retry interval
- Replaced static "Retrying automatically..." with "Retrying... Ns" using new `app.server.retryElapsed` i18n key
- Added `serverUrl` createMemo that extracts `current.http.url` from the active server connection
- Show "Try running: cobuilder serve" when no server URL is known (local/sidecar without URL)
- Show "Check that the server is running at <url>" when a URL is available
- Added `app.server.retryElapsed`, `app.server.hint.serve`, `app.server.hint.url` to all 17 locale files

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Duplicate keys in es.ts from sed pre-run**
- **Found during:** Task 2 typecheck
- **Issue:** An earlier sed command ran before the Python batch script, inserting keys twice into es.ts (lines 880-885 had 3 duplicate keys)
- **Fix:** Removed the 3 duplicate lines (880-882) leaving only the Python-inserted set
- **Files modified:** packages/app/src/i18n/es.ts
- **Commit:** df8fb50

**2. [Rule 1 - Bug] HttpBase type mismatch in serverUrl memo**
- **Found during:** Task 2 typecheck (`error TS2322: Type 'HttpBase' is not assignable to type 'string | number | boolean'`)
- **Issue:** Plan specified `return "http" in current ? current.http : undefined` but `current.http` is `HttpBase` (object with `.url: string`), not a string. The `language.t()` interpolation requires a string value.
- **Fix:** Changed to `current.http.url` to extract the string URL
- **Files modified:** packages/app/src/app.tsx
- **Commit:** df8fb50

**3. [Scope expansion] Updated all 17 locale files, not just 4**
- **Found during:** Task 2 setup
- **Reason:** All 17 locales already had `app.server.retrying` and a parity test exists (`parity.test.ts`). Adding keys to only 4 would break the parity test for 13 locales.
- **Fix:** Added English fallback translations to the 13 unspecified locales
- **Files modified:** de.ts, fr.ts, ja.ts, ko.ts, pl.ts, ru.ts, th.ts, tr.ts, ar.ts, br.ts, bs.ts, da.ts

## Known Stubs

None — all i18n keys are wired to real UI. The elapsed counter and hint display are fully reactive.

## Self-Check: PASSED

- packages/opencode/src/cli/cmd/onboard.ts — FOUND, contains 4x "Step N of 4"
- packages/app/src/app.tsx — FOUND, contains elapsedSeconds signal and hint Shows
- packages/app/src/i18n/en.ts — FOUND, contains app.server.retryElapsed and hint keys
- Commit 4449618 — Task 1 (onboard.ts step prefixes)
- Commit df8fb50 — Task 2 (ConnectionError + i18n)
- Both typechecks pass (opencode: clean, app: clean)
