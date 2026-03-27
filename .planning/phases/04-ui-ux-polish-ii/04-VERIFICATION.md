---
phase: 04-ui-ux-polish-ii
verified: 2026-03-26T00:00:00Z
status: passed
score: 5/5 must-haves verified
---

# Phase 4: UI/UX Polish II Verification Report

**Phase Goal:** Fix the next tier of UI/UX issues — add first-run guidance to TUI and Web home screens, make connection errors actionable, improve the TUI update flow to avoid abrupt exit, and add step progress to the onboarding wizard.
**Verified:** 2026-03-26
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | TUI home shows getting-started hints for first-time users | VERIFIED | `home.tsx:35-41,121-135` — `isFirstTimeUser()` = `session.length === 0`; `<Show when={isFirstTimeUser()}>` renders 3 hint lines below prompt |
| 2 | Web home shows "Getting started" panel for users with no sessions | VERIFIED | `pages/home.tsx:124-147` — `<Match when={true}>` (no-projects fallback) renders numbered steps 1-3 via `home.gettingStarted.*` i18n keys |
| 3 | ConnectionError shows elapsed retry time and actionable instructions | VERIFIED | `app.tsx:258-291` — `elapsedSeconds` signal increments every 1s, rendered as `retryElapsed`; hint.serve / hint.url shown conditionally |
| 4 | TUI update downloads in background; shows badge instead of exiting | VERIFIED | `app.tsx:740-801` — `installation.update-available` event triggers background `sdk.client.global.upgrade()`; `setPendingUpdate` drives persistent badge; no process.exit |
| 5 | `cobuilder onboard` shows step progress (Step N of 4) | VERIFIED | `onboard.ts:31,228,272,322` — "Step 1 of 4", "Step 2 of 4", "Step 3 of 4", "Step 4 of 4" via `prompts.log.step()` |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `packages/opencode/src/cli/cmd/onboard.ts` | VERIFIED | Substantive (373 lines); step labels at lines 31, 228, 272, 322 |
| `packages/app/src/app.tsx` | VERIFIED | `ConnectionError` component (lines 251-316) has elapsed timer + conditional hints; i18n keys exist in `en.ts` |
| `packages/opencode/src/cli/cmd/tui/routes/home.tsx` | VERIFIED | `isFirstTimeUser()` signal + `<Show>` block renders 3 hint lines (lines 35-41, 121-135) |
| `packages/app/src/pages/home.tsx` | VERIFIED | No-project `<Match when={true}>` block (lines 124-147) renders 3-step getting started panel |
| `packages/opencode/src/cli/cmd/tui/app.tsx` | VERIFIED | Background download on `installation.update-available` (lines 740-772); persistent badge (lines 789-801) via `pendingUpdate()` signal |

### Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| `home.tsx` isFirstTimeUser | `sync.data.session.length` | `createMemo` | WIRED — reactive, not hardcoded |
| `app.tsx` ConnectionError | elapsed timer | `setInterval` + `onCleanup` | WIRED — starts on mount, cleans up on unmount |
| `app.tsx` ConnectionError hints | server URL detection | `serverUrl()` memo | WIRED — conditionally shows serve vs URL hint |
| `app.tsx` update badge | `pendingUpdate()` signal | `sdk.client.global.upgrade()` result | WIRED — badge only shows after successful download |
| `onboard.ts` step labels | `prompts.log.step()` | `@clack/prompts` | WIRED — called at correct positions in flow |
| `pages/home.tsx` getting-started panel | `sync.data.project.length` | `<Switch><Match>` order | WIRED — panel is last fallback when project list is empty |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|-------------------|--------|
| `home.tsx` isFirstTimeUser | `sync.data.session` | SyncProvider (server-backed) | Yes | FLOWING |
| `pages/home.tsx` getting-started | `sync.data.project` | `useGlobalSync()` | Yes | FLOWING |
| `app.tsx` elapsedSeconds | `setInterval` counter | Local timer | Yes (monotonic) | FLOWING |
| `app.tsx` pendingUpdate | `sdk.client.global.upgrade()` response | API call | Yes | FLOWING |

### Behavioral Spot-Checks

Step 7b: SKIPPED — artifacts are UI/TUI components requiring a running server; cannot test without starting services.

### Requirements Coverage

All five success criteria map directly to verified truths above. No orphaned requirements found.

### Anti-Patterns Found

None. No TODO/FIXME/placeholder comments in the verified files. No empty handlers. No hardcoded empty data flowing to rendered output. The `return null` in `OnboardingCheck` (app.tsx:146) is intentional — the component is side-effect only.

### Human Verification Required

#### 1. TUI first-run hints visible on clean state

**Test:** Run `cobuilder` with no prior sessions (e.g. fresh `~/.opencode` or `OPENCODE_STATE=/tmp/fresh cobuilder`).
**Expected:** Three hint lines appear below the prompt box: one about typing a message, one about Ctrl+X, one about /help.
**Why human:** TUI rendering requires a live terminal; can't verify layout from code alone.

#### 2. Web getting-started panel renders for new user

**Test:** Open the web app with no projects configured.
**Expected:** Numbered steps 1-3 appear in the home centre column instead of the recent projects list.
**Why human:** Requires browser with no existing project history.

#### 3. ConnectionError elapsed counter increments visibly

**Test:** Start web app pointing at a non-existent server.
**Expected:** "Retrying... Ns" counter increments every second; hint "Try running: cobuilder serve" is visible.
**Why human:** Requires live browser session.

#### 4. TUI update badge stays persistent after simulated update

**Test:** Trigger `installation.update-available` event with a test version.
**Expected:** Top bar shows "Update vX.Y.Z ready — restart to apply" badge without TUI exiting.
**Why human:** Requires event injection into running TUI process.

### Gaps Summary

No gaps. All five success criteria are fully implemented and wired to real data sources. The phase goal is achieved.

---

_Verified: 2026-03-26_
_Verifier: Claude (gsd-verifier)_
