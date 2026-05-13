# OpenCode Session Scroll Implementation Plan

Date: 2026-04-02

## Objective

Implement the scroll simplification proposal in small, verifiable patches.

Primary goal:

- eliminate competing `scrollTop` writers in the main session view

Secondary goal:

- retain enough performance protection for long sessions without reintroducing unstable scroll behavior

## Non-Goals For Initial Rollout

- perfect long-history virtualization
- redesigning message rendering structure
- changing session URL/hash semantics
- changing review tab scroll behavior

## Delivery Strategy

Ship in ordered patches.

Rules:

1. Each patch should leave the app in a testable state.
2. Stability patches land before performance patches.
3. Do not mix architectural simplification with speculative optimization.

## Patch 1: Add Explicit Page-Level Scroll Mode

### Goal

Introduce a single canonical scroll mode in the session page:

- `live`
- `anchored`

This patch should not yet remove major mechanisms. It should first make user intent explicit.

### Files

- `packages/app/src/pages/session.tsx`
- `packages/app/src/pages/session/use-session-hash-scroll.ts`

### Changes

1. Add page-level state for:
   - `mode: "live" | "anchored"`
   - `anchorId?: string`
   - `anchorTop?: number`

2. Map existing behaviors into this model:
   - user returns to bottom -> `live`
   - user scrolls away from latest -> `anchored`
   - hash target / message target -> `anchored`
   - jump to latest button -> `live`

3. Keep existing `userScrolled` wiring temporarily, but make it derive from the new page mode where possible.

4. Add a small helper layer in `session.tsx`:
   - `enterLive()`
   - `enterAnchored(id?: string)`

5. In `use-session-hash-scroll.ts`, stop encoding navigation state in multiple booleans where page mode can already express it.

### Acceptance

- no behavior regression on normal send / read / jump-to-latest flow
- session page has one explicit source of truth for "follow latest vs reading history"

### Risks

- hidden assumptions currently tied to `autoScroll.userScrolled()`

### Verification

Manual:

- open a session at bottom
- scroll upward and verify mode flips to anchored
- click jump-to-latest and verify mode flips to live
- open a hash link and verify mode becomes anchored

## Patch 2: Remove Turn-Level Auto-Scroll In Main Timeline

### Goal

Stop `SessionTurn` from acting as an independent scroll controller when mounted inside the main session timeline.

### Files

- `packages/ui/src/components/session-turn.tsx`
- `packages/app/src/pages/session/message-timeline.tsx`

### Changes

1. Add explicit props to `SessionTurn` for main timeline usage if needed:
   - `autoScroll?: boolean`
   - `fill?: boolean`

2. In the main session timeline, pass:
   - `autoScroll={false}`
   - timeline-compatible sizing

3. Ensure `SessionTurn` still works in other contexts if they rely on internal auto-scroll.

4. Remove any main-timeline dependence on turn-level `onUserInteracted`.

### Acceptance

- page-level session scroll still works
- expanding diff sections or tool sections no longer causes nested scroll policy conflicts

### Risks

- some message-internal layouts may rely on turn-level resize-follow today

### Verification

Manual:

- stream a long assistant response
- expand/collapse diff blocks
- expand/collapse tool outputs
- confirm the main page scroll remains stable and is not jerked by nested logic

## Patch 3: Disable Main Timeline Virtualization

### Goal

Remove the highest-risk structural scroll mutation while keeping history slicing.

### Files

- `packages/app/src/pages/session/message-timeline.tsx`
- `packages/app/src/pages/session/message-timeline-utils.ts`
- any related tests

### Changes

1. Remove or gate off `Virtualizer` usage in the main session timeline.

2. Delete virtualization flip restoration logic from the session path:
   - captured top/gap restore for virtual/non-virtual transitions
   - pin restore specific to virtualization changes

3. Keep helper functions only if still used elsewhere or by tests.

4. Update tests to reflect that main timeline no longer flips virtualization.

### Acceptance

- long session still opens with history slicing
- no virtual/non-virtual flip occurs during working / idle transitions

### Risks

- desktop rendering cost rises for very large visible windows

### Verification

Manual:

- open medium and long sessions
- verify there is no layout jump when generation starts or completes
- compare CPU/UI responsiveness before and after on long history

## Patch 4: Simplify History Window Preservation

### Goal

Keep history slicing, but reduce custom preserve logic to one page-level anchor path.

### Files

- `packages/app/src/pages/session.tsx`
- possibly extract helper:
  - `packages/app/src/pages/session/session-scroll-anchor.ts`

### Changes

1. Extract a reusable anchor utility:
   - capture current visible message id and relative top
   - restore after render

2. Replace duplicated `hold/snap/keep/restore` style logic with this single utility.

3. History window responsibilities become:
   - determine `turnStart`
   - request more history
   - ask page to preserve anchor around expansion

4. Remove long repeated restore loops unless they are still empirically necessary.

### Acceptance

- upward reveal of cached turns preserves the user's reading position
- server-side history load also preserves the reading position

### Risks

- history expansion timing may still need one bounded settle frame

### Verification

Manual:

- scroll near top with cached turns hidden
- reveal more turns
- verify the previously visible message stays in place
- repeat with server-side history fetch

## Patch 5: Convert Follow-Latest To Event-Driven Policy

### Goal

Stop treating generic resize as a reason to resume latest-follow.

### Files

- `packages/ui/src/hooks/create-auto-scroll.tsx`
- `packages/app/src/pages/session.tsx`
- `packages/app/src/pages/session/use-session-hash-scroll.ts`

### Changes

1. Narrow `createAutoScroll` so it becomes a lower-level primitive:
   - detect bottom
   - detect user leaving bottom
   - apply requested scroll-to-bottom

2. Move policy decisions into `session.tsx`:
   - send new prompt -> enter live and scroll latest
   - jump-to-latest -> enter live and scroll latest
   - hash navigation -> enter anchored
   - user scroll upward -> enter anchored

3. Resize handling should become:
   - if mode is live: preserve bottom
   - if mode is anchored: preserve anchor
   - otherwise no-op

4. Remove generic resize-triggered "follow latest" behavior from page policy.

### Acceptance

- markdown upgrades do not unexpectedly pull the user back to latest
- dock height changes do not unexpectedly switch mode

### Risks

- some flows currently depend on implicit follow after resize

### Verification

Manual:

- while reading older messages, wait for streaming/markdown growth
- verify viewport remains anchored
- while live at bottom, stream output and verify bottom remains locked

## Patch 6: Unify Hash Navigation With Page Scroll Owner

### Goal

Make hash/message navigation produce page-level scroll intents instead of running a second independent settle system.

### Files

- `packages/app/src/pages/session/use-session-hash-scroll.ts`
- `packages/app/src/pages/session.tsx`

### Changes

1. Refactor `useSessionHashScroll` to:
   - parse hash
   - request target message reveal
   - ask page scroll owner to navigate

2. Keep message lookup and history loading logic.

3. Remove duplicated direct scroll restore behavior if page anchor utility now covers it.

4. Make precedence explicit:
   - explicit hash target beats live follow
   - clearing hash does not silently override an anchored reader unless user explicitly resumes live

### Acceptance

- hash links still work
- no jump-to-bottom race after navigating to a message target

### Risks

- regressions in pending-message resume behavior

### Verification

Manual:

- open session with hash
- open pending message target
- clear hash
- use jump-to-latest

## Patch 7: Remove Debug / Legacy Branches And Tighten Tests

### Goal

After simplification lands, delete temporary instrumentation and add regression coverage.

### Files

- `packages/app/src/pages/session/*.test.ts*`
- `packages/ui/src/hooks/*.test.ts*`
- any debug-heavy scroll code

### Changes

1. Add tests for:
   - history reveal preserves anchor
   - hash target reveals hidden message correctly
   - live mode stays at bottom on content growth
   - anchored mode does not snap to bottom on content growth

2. Delete now-dead helpers and restore paths.

3. Remove debug logs once manual validation is complete.

### Acceptance

- simplified scroll model has regression coverage
- dead code from old competing paths is gone

## Recommended Execution Order

1. Patch 1
2. Patch 2
3. Patch 3
4. Patch 4
5. Patch 5
6. Patch 6
7. Patch 7

This order is important:

- Patch 1 creates the vocabulary
- Patch 2 removes the most obvious conflict
- Patch 3 removes the most unstable structural mutation
- Patch 4 and Patch 5 simplify preservation/follow logic after the surface area is smaller

## Rollback Strategy

If a patch regresses user-visible behavior:

1. revert the last patch only
2. keep earlier simplification patches
3. do not reintroduce multiple scroll owners as a quick fix

If performance becomes unacceptable after Patch 3:

- measure first
- prefer reducing visible history window size before reintroducing virtualization

## Manual Test Matrix

Run after each relevant patch:

1. New session, short conversation
2. Long conversation, open at bottom
3. Long conversation, scroll upward and load older history
4. Long conversation with markdown-heavy assistant output
5. Conversation with code blocks and tool outputs
6. Hash deep link to an older message
7. Jump-to-latest from anchored mode
8. Session switch away and back
9. Dock height change while live
10. Dock height change while anchored

## Success Criteria

The plan succeeds if:

1. the main session timeline has exactly one scroll owner
2. upward history loading no longer causes visible jump jitter
3. markdown delayed growth no longer drags anchored readers to bottom
4. live-bottom mode remains reliable during streaming
5. the code path becomes smaller and easier to reason about than the current combined system
