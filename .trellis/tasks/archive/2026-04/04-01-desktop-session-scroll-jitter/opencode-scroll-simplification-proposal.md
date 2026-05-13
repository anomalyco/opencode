# OpenCode Session Scroll Simplification Proposal

Date: 2026-04-02

## Goal

Reduce session scroll jitter by shrinking the number of independent scroll systems in the main session view.

This proposal is intentionally biased toward stability over maximum optimization.

## Problem Statement

The current session view mixes several independently reasonable mechanisms:

- page-level auto-follow
- turn-level auto-scroll
- history window slicing
- history prefetch and upward loading
- hash/message targeting
- virtualization and virtualization flip restoration
- markdown delayed rendering / height upgrades
- sticky header offset compensation

The bug surface is not from one bad mechanism alone. It is from multiple layers being allowed to react to the same layout change and write `scrollTop`.

## Design Principle

Only one layer should own final writes to the main session scroller.

Everything else should produce intent or metadata, not directly fight over scroll position.

## Proposed Architecture

### 1. One scroll owner

The page-level session scroller in `packages/app/src/pages/session.tsx` becomes the only component allowed to directly control main timeline `scrollTop`.

Allowed direct writers:

- explicit jump to latest
- explicit jump to message/hash target
- page-level anchor preservation after layout changes
- page-level initial restore on session switch

Disallowed direct writers:

- `SessionTurn`
- message item internals
- markdown component
- virtualization helper internals

### 2. Remove turn-level auto-scroll from main timeline usage

`packages/ui/src/components/session-turn.tsx` should not run its own `createAutoScroll` when rendered inside the main session timeline.

Keep turn-level auto-scroll only if `SessionTurn` is used in a truly isolated scroll container elsewhere.

Why:

- it duplicates page-level follow logic
- it reacts to nested content resize
- it can reinterpret layout growth as a reason to scroll independently of page intent

### 3. Keep history slicing, simplify its job

Keep `createSessionHistoryWindow`, but narrow its responsibility to:

- initial render window
- reveal older cached turns
- request older turns from server

Remove from its responsibility:

- long multi-frame custom scroll compensation loops if page-level anchor preservation replaces them cleanly

Preferred model:

- before a history expansion, page captures one anchor
- after expansion, page restores anchor once or with a very short bounded settle

History window should decide what data is rendered, not become a second scroll state machine.

### 4. Disable main timeline virtualization for now

Short term recommendation:

- remove timeline virtualization from the desktop session path until scroll ownership is simplified

Reason:

- history slicing already limits initial DOM cost
- virtualization flip introduces another large structural mutation
- current session view has dynamic heights, sticky header offsets, hash targeting, and delayed markdown upgrades
- that combination makes virtualization a multiplier on instability

Long term:

- only reintroduce virtualization if it can operate under a strict contract with the page-level scroll owner

### 5. Replace resize-driven follow logic with intent-driven follow logic

Current behavior overreacts to content/layout changes.

Proposed model:

- semantic events decide whether follow-latest is active
- passive resize does not automatically imply "scroll to latest"

Follow-latest should become active on:

- user sends a new message
- user clicks jump-to-latest
- hash target is cleared and user explicitly returns to live bottom

Follow-latest should become inactive on:

- user scrolls upward intentionally
- user navigates to a specific message
- user uses history navigation

When passive layout changes happen:

- if in follow-latest, preserve bottom
- if not in follow-latest, preserve the current anchor
- otherwise do nothing

### 6. Unify position model

Today there are several overlapping notions of "where the user is":

- `scrollTop`
- `userScrolled`
- `turnStart`
- pending message id
- current hash target
- active message id

Proposed canonical state:

- `mode = live | anchored`
- if `live`: bottom-follow is authoritative
- if `anchored`: one message anchor id plus relative offset is authoritative

Derived state:

- `userScrolled` becomes `mode === "anchored"`
- hash target maps into an anchored mode
- `turnStart` remains a rendering concern, not a user-position concern

### 7. Explicit precedence rules

Scroll intents must have a strict priority order:

1. explicit user navigation
   - click message link
   - hash deep link
   - jump to latest
2. anchored position restore
   - preserve current reading position across layout/history changes
3. live follow
   - stay at latest while active
4. passive content change
   - no independent scroll decision

If two mechanisms trigger in the same render window, the higher-priority one wins and lower-priority ones must no-op.

## Concrete Changes

### Phase 1: Stabilize

1. Add a page-level `scroll mode` model:
   - `live`
   - `anchored`

2. Remove `SessionTurn` auto-scroll from timeline usage.

3. Keep page-level `createAutoScroll`, but reduce it:
   - no content-resize-triggered policy decisions
   - only expose helpers to apply live-bottom behavior when page logic asks for it

4. Keep history slicing.

5. Turn off main timeline virtualization.

6. Make markdown and other dynamic content report only "height changed", not "scroll now".

### Phase 2: Anchor preservation

1. Create a small page-level anchor utility:
   - capture visible message anchor id
   - capture relative top offset
   - restore after DOM growth or history expansion

2. Use the same anchor utility for:
   - history reveal/load
   - markdown delayed growth
   - dock height changes
   - sticky header changes

3. Remove duplicate preserve logic from multiple places once the shared path works.

### Phase 3: Hash and navigation cleanup

1. Let hash navigation switch page mode to `anchored`.
2. Let jump-to-latest switch page mode to `live`.
3. Make `useSessionHashScroll` request page-level anchor/jump actions instead of directly combining several restore paths.

### Phase 4: Performance reevaluation

Only after stability is proven:

1. measure session open time
2. measure large-history scroll cost
3. decide whether virtualization is still needed

Possible result:

- keep slicing only
- or reintroduce virtualization behind a stricter contract

## Recommended Ownership Matrix

### `session.tsx`

Owns:

- scroll mode
- anchor capture/restore
- live-bottom intent
- history load/reveal orchestration
- jump-to-message / jump-to-latest application

Must be the only main scroller writer.

### `message-timeline.tsx`

Owns:

- rendering the current message set
- exposing message DOM nodes and ids
- boundary gesture detection

Must not own final scroll restoration policy.

### `use-session-hash-scroll.ts`

Owns:

- parsing hash / pending message target
- asking page layer to navigate

Must not become a second scroll state machine.

### `session-turn.tsx`

Owns:

- rendering one user turn
- local collapsible UI behavior

Must not control main timeline scroll.

### `markdown.tsx`

Owns:

- progressive rendering
- height-changing content lifecycle

Must not imply "follow latest" by itself.

## Expected Benefits

- fewer competing `scrollTop` writes
- clearer reasoning about user intent
- better behavior when markdown height changes after first paint
- less coupling between history loading and scroll restoration
- easier debugging because one layer owns final behavior

## Expected Tradeoffs

- short-term performance may regress if virtualization is disabled
- some "helpful" auto-follow behavior may disappear until explicitly rebuilt
- page-level anchor handling will need careful implementation

These are acceptable tradeoffs if the goal is to stop visible jitter first.

## Recommendation

Adopt the conservative path:

1. one page-level scroll owner
2. no turn-level auto-scroll in the timeline
3. no main timeline virtualization for now
4. keep history slicing
5. event-driven live-follow
6. single anchor-based restore path

This is the smallest architecture that still supports:

- long conversations
- upward history loading
- deep linking to messages
- jump to latest
- delayed markdown rendering

without layering several competing scroll state machines.
