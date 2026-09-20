# T05 Verification: Header shortcuts and pending-input access

Task: T05 Add header shortcuts and preserve pending-input access.
Worktree: `/root/git/opencode/.worktrees/execution-ui`
Branch: `execution-ui`
Base: `v2` at `c555559ac1b94910b769eebaa595b2b8822efa14` (OpenCode 2.0.11), after T04 `8a7a6bae37`.
Recorded: 2026-09-21

## Files

Created:

- `packages/app/src/superpowers/status-badge.tsx`
- `packages/app/src/superpowers/status-badge.test.ts`

Modified:

- `packages/app/src/superpowers/model.ts`
- `packages/app/src/superpowers/model.test.ts`
- `packages/app/src/session/header/session-header-actions.tsx`
- `packages/app/src/session/screen.tsx`
- `packages/app/src/session/summary/background.tsx`
- `packages/app/src/session/summary/panel.tsx`
- `packages/app/src/runtime/i18n/en.ts` (English source keys only)
- `packages/app/component-tests/superpowers.fixture.tsx`
- `packages/app/component-tests/superpowers.spec.ts`
- `docs/superpowers/verification/execution-ui/task-5.md`

No Core, native Protocol/HttpApi, generated client, or timeline row rendering change. No new code
comments. All production-visible copy uses i18n keys.

## Interfaces produced

- `attentionState({ stale, needsInput, failed, blocked })` returns exactly
  `stale -> needs_input -> failed -> blocked -> normal`, matching the brief anchor.
- `ExecutionStatusBadge({ model, onOpen })` renders text plus icon for the current attention state
  (`stale`/`needs_input`/`failed`/`blocked`/`normal`), a polite `role="status"` live region, and,
  while `needs_input`, one `Review pending request` action that calls `model.reviewRequest()`. The
  primary action is named `Open execution overview`; below 768 px the status text is hidden but the
  accessible name is unchanged.
- `ExecutionModel.reviewRequest()` forwards to the injected native request focus action.
- `BackgroundWorkSummary({ tasks, mobile, onViewAgents })` keeps the existing task list and adds
  exactly one `View all agents` action inside the same popover. `SessionSummaryPanel` threads
  `onViewAgents` to it; `screen.tsx` supplies the open action for the mobile summary.

## Attention reuses native request state

- `screen.tsx` builds `attention` from the existing `createActiveSessionRegion` request model:
  `permissionRequest()`/`questionRequest()` for `needsInput`, `background.blocking()` for `blocked`,
  and the selected server SDK `connection.status()` for `stale`. No parallel request cache is added.
- `sessionPermissionRequest`/`sessionFormRequest` already walk `sessionTreeIDs`, so a pending
  permission or question on a descendant session contributes attention for the root.

## Permission/question flows untouched

- The badge never calls `decide`, `prompt`, `subagent`, or interrupt; its only actions are
  `model.reviewRequest()` (focus) and `onOpen`.
- The only production integration points are the header badge, the summary popover action, and
  `reviewRequest` focusing the first control in `[data-component="session-composer-dock"]`. The
  native `SessionPermissionDock`/`SessionQuestionDock` replies are unchanged.

## TDD evidence

RED (before implementation), with the new fixture importing `@/superpowers/status-badge`:

Unit suite:

```text
src/superpowers/status-badge.test.ts:
error: Cannot find module './status-badge' from '.../src/superpowers/status-badge.test.ts'
 0 pass
 1 fail
 1 error
```

Component suite, exact brief command:

```text
$ cd packages/app
$ bun run test:components component-tests/superpowers.spec.ts --grep "execution shortcut"
  8 failed
    execution shortcut preserves permission handling
    execution shortcut reuses nested child requests for attention
    execution shortcut surfaces question forms
    execution shortcut prefers a stale connection before pending input
    execution shortcut keeps an accessible name when narrow
    execution shortcut mirrors the icon before the label in rtl
    execution shortcut opens execution while review stays closed
    execution shortcut never replies, prompts, or interrupts
  Error: page.evaluate: TypeError: Failed to fetch dynamically imported module:
  .../component-tests/superpowers.fixture.tsx
```

GREEN (after implementation).

Unit suite:

```text
$ bun test --conditions=solid --preload ./happydom.ts ./src/superpowers
 55 pass
 0 fail
 184 expect() calls
Ran 55 tests across 5 files.
```

Component suite, exact brief command (default workers):

```text
$ bun run test:components component-tests/superpowers.spec.ts --grep "execution shortcut"
Running 8 tests using 6 workers
  8 passed (39.0s)
```

Background summary cases (brief's required additional coverage):

```text
$ bun run test:components component-tests/superpowers.spec.ts --grep "background summary" --workers=2
Running 2 tests using 2 workers
  2 passed (2.4m)
```

Full superpowers component spec:

```text
$ bun run test:components component-tests/superpowers.spec.ts --workers=2
Running 25 tests using 2 workers
  24 passed, 1 failed (cold-compile "Failed to fetch dynamically imported module" on
  "execution shortcut surfaces question forms")
```

The single cold-compile failure passed when rerun alone:

```text
$ bun run test:components component-tests/superpowers.spec.ts --grep "execution shortcut surfaces question forms" --workers=1
  1 passed (2.5m)
```

## Focused verification

| Command | Result |
|---|---|
| `bun run test:components component-tests/superpowers.spec.ts --grep "execution shortcut"` | PASS: 8 passed |
| `bun run test:components component-tests/superpowers.spec.ts --grep "background summary" --workers=2` | PASS: 2 passed |
| `bun run test:components component-tests/superpowers.spec.ts --workers=2` | PASS 24/25; 1 cold-compile flake rerun alone passed |
| `bun test --conditions=solid --preload ./happydom.ts ./src/superpowers` | PASS: 55 pass, 0 fail, 184 expect() calls |
| `bun test --conditions=solid --preload ./happydom.ts ./src` | PASS: 915 pass, 1 skip, 0 fail |
| `bun run typecheck` (`tsgo -b`) | PASS (exit 0) |
| `oxlint` on the 11 changed code files | PASS: 0 warnings, 0 errors |

Environment note (recorded, not hidden): a cold Storybook module graph can fail one story with
`Failed to fetch dynamically imported module` at the fixture bootstrap; the same story passes when
rerun. This is the T04-observed Storybook dev-server compilation behavior, not a product failure.

## Unrun gates

| Gate | Exact command | Outcome |
|---|---|---|
| Root canonical `bun run check` | `bun run check` (repo root) | UNRUN for this task; not required by the T05 brief. `packages/app` `bun run typecheck` and `oxlint` on changed files were run directly. |
| `packages/app` build | `bun run build` | UNRUN; not required by the T05 brief (T11/T20 cover build). |
| Full `SessionScreen` mount | component harness | UNRUN. The harness aliases server/layout modules; the T05 fixture mounts the production `ExecutionStatusBadge`, `LazyExecutionPanel`, `SessionTabAddControl`, and `BackgroundWorkSummary` instead. |
| Desktop summary popover wiring | manual/runtime | UNRUN. `message-timeline.tsx` is outside the brief's file list and does not pass `onViewAgents`; the action is component-level and wired for the mobile summary in `screen.tsx`. |
| e2e/live-server, Windows Desktop smoke | plan AC18-AC20 | UNRUN; belong to later tasks; no live service was contacted. |

No threshold was changed and no result was fabricated.

## Self-review

- `attentionState` returns the exact anchor priority and `model.attention()` is read reactively by
  the badge.
- Status is text plus an icon for every state, never color-only; a polite `role="status"` region
  announces changes only when the derived label changes.
- The header badge keeps its accessible name (`Open execution overview`) when the visible label is
  hidden below 768 px, and its RTL flex order places the icon at the inline start.
- `Review pending request` only focuses the native request controls (`model.reviewRequest()`); it
  does not call `permission.reply`, `prompt`, `subagent`, or `interrupt`, which the fixture counters
  assert stay at `0`.
- The existing background shell summary is preserved; exactly one `View all agents` action is added
  and shell jobs keep their labels.
- The badge sits beside the existing review toggle; opening Execution also selects the Agents
  subview so the same action is consistent from the header and the summary.

## Review round 1 fixes

Finding 1 (desktop summary link, authorized file extension):

- `message-timeline.tsx` gained `onViewAgents` on `MessageTimelineProps`, forwarded to
  `SessionSummaryPanel`; `screen.tsx` supplies `openExecutionOverview`.
- New `desktop-summary` fixture scenario mounts the real `SessionSummaryPanel` with the app
  providers and `onViewAgents`; story `desktop summary composition opens agents` opens the
  background-summary popover, asserts one `View all agents`, clicks it, and asserts Execution →
  Agents opens. It no longer mounts `BackgroundWorkSummary` directly.
- Enabling test-infra change: added `event.listen`/`event.location` and `api.worktree` to the
  Storybook `@/runtime/server/client` mock (`packages/storybook/.storybook/mocks/app/context/
  server-sdk.ts`), which `SessionWorkspaceMenu` reads at render. Additive only.

Finding 2 (compact summary detail and tooltip):

- `ExecutionStatusBadge` derives the visible summary from `model.progress()` and `model.agents()`
  in §5.5 order (stale → pending input → failed → blocked → verification → active agents →
  ready), says "Execution blocked", and wraps the control in a `Tooltip` that preserves full
  detail. New English keys for the verification string, active-agent plural, and detail rows.
- New stories: verification progress, active-agent count, blocked wording, tooltip detail.

Out of scope (unchanged): `attention.failed` stays `0`; T11 wires the failure source.

### Fix-round verification

| Command | Result |
|---|---|
| `bun test --conditions=solid --preload ./happydom.ts ./src/superpowers` | PASS: 55 pass, 0 fail, 184 expect() calls |
| `bun run test:components component-tests/superpowers.spec.ts --grep "execution shortcut\|summary" --workers=2` | 14 passed, 1 cold-Storybook-compile flake (`Failed to fetch dynamically imported module`); the flaky story passed alone |
| `bun run test:components component-tests/superpowers.spec.ts --grep "execution shortcut\|summary" --workers=2 --retries=1` | PASS: 15 passed |
| `bun run test:components component-tests/superpowers.spec.ts --workers=2 --retries=1` | PASS: 30 passed |
| `bun run typecheck` (`tsgo -b`) | PASS (exit 0) |
| `oxlint` on 7 changed files | PASS: 0 warnings, 0 errors |

Files changed in the fix round: `status-badge.tsx`, `en.ts`, `message-timeline.tsx`,
`screen.tsx`, `superpowers.fixture.tsx`, `superpowers.spec.ts`,
`packages/storybook/.storybook/mocks/app/context/server-sdk.ts`, and this record.
