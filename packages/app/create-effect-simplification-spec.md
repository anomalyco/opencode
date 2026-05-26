# CreateEffect Simplification Implementation Spec

Reduce reactive misuse across `packages/app`.

---

## Context

This work targets `packages/app/src`, which currently has 101 `createEffect` calls across 37 files.

The biggest clusters are `pages/session.tsx` (19), `pages/layout.tsx` (13), `pages/session/file-tabs.tsx` (6), and several context providers that mirror one store into another.

Key issues from the audit:

- Derived state is being written through effects instead of computed directly
- Session and file resets are handled by watch-and-clear effects instead of keyed state boundaries
- User-driven actions are hidden inside reactive effects
- Context layers mirror and hydrate child stores with multiple sync effects
- Several areas repeat the same imperative trigger pattern in multiple effects

Keep the implementation focused on removing unnecessary effects, not on broad UI redesign.

## Goals

- Cut high-churn `createEffect` usage in the hottest files first
- Replace effect-driven derived state with reactive derivation
- Replace reset-on-key effects with keyed ownership boundaries
- Move event-driven work to direct actions and write paths
- Remove mirrored store hydration where a single source of truth can exist
- Leave necessary external sync effects in place, but make them narrower and clearer

## Non-Goals

- Do not rewrite unrelated component structure just to reduce the count
- Do not change product behavior, navigation flow, or persisted data shape unless required for a cleaner write boundary
- Do not remove effects that bridge to DOM, editors, polling, or external APIs unless there is a clearly safer equivalent
- Do not attempt a repo-wide cleanup outside `packages/app`

## Effect Taxonomy And Replacement Rules

Use these rules during implementation.

### Prefer `createMemo`

Use `createMemo` when the target value is pure derived state from other signals or stores.

Do this when an effect only reads reactive inputs and writes another reactive value that could be computed instead.

Apply this to:

- `packages/app/src/pages/session.tsx:141`
- `packages/app/src/pages/layout.tsx:557`
- `packages/app/src/components/terminal.tsx:261`
- `packages/app/src/components/session/session-header.tsx:309`

Rules:

- If no external system is touched, do not use `createEffect`
- Derive once, then read the memo where needed
- If normalization is required, prefer normalizing at the write boundary before falling back to a memo

### Prefer Keyed Remounts

Use keyed remounts when local UI state should reset because an identity changed.

Do this with `sessionKey`, `scope()`, or another stable identity instead of watching the key and manually clearing signals.

Apply this to:

- `packages/app/src/pages/session.tsx:325`
- `packages/app/src/pages/session.tsx:336`
- `packages/app/src/pages/session.tsx:477`
- `packages/app/src/pages/session.tsx:869`
- `packages/app/src/pages/session.tsx:963`
- `packages/app/src/pages/session/message-timeline.tsx:149`
- `packages/app/src/context/file.tsx:100`

Rules:

- If the desired behavior is "new identity, fresh local state," key the owner subtree
- Keep state local to the keyed boundary so teardown and recreation handle the reset naturally

### Prefer Event Handlers And Actions

Use direct handlers, store actions, and async command functions when work happens because a user clicked, selected, reloaded, or navigated.

Do this when an effect is just watching for a flag change, command token, or event-bus signal to trigger imperative logic.

Apply this to:

- `packages/app/src/pages/layout.tsx:484`
- `packages/app/src/pages/layout.tsx:652`
- `packages/app/src/pages/layout.tsx:776`
- `packages/app/src/pages/layout.tsx:1489`
- `packages/app/src/pages/layout.tsx:1519`
- `packages/app/src/components/file-tree.tsx:328`
- `packages/app/src/pages/session/terminal-panel.tsx:55`
- `packages/app/src/context/global-sync.tsx:148`
- Duplicated trigger sets in:
  - `packages/app/src/pages/session/review-tab.tsx:122`
  - `packages/app/src/pages/session/review-tab.tsx:130`
  - `packages/app/src/pages/session/review-tab.tsx:138`
  - `packages/app/src/pages/session/file-tabs.tsx:367`
  - `packages/app/src/pages/session/file-tabs.tsx:378`
  - `packages/app/src/pages/session/file-tabs.tsx:389`
  - `packages/app/src/pages/session/use-session-hash-scroll.ts:144`
  - `packages/app/src/pages/session/use-session-hash-scroll.ts:149`
  - `packages/app/src/pages/session/use-session-hash-scroll.ts:167`

Rules:

- If the trigger is user intent, call the action at the source of that intent
- If the same imperative work is triggered from multiple places, extract one function and call it directly

### Prefer `onMount` And `onCleanup`

Use `onMount` and `onCleanup` for lifecycle-only setup and teardown.

This is the right fit for subscriptions, one-time wiring, timers, and imperative integration that should not rerun for ordinary reactive changes.

Use this when:

- Setup should happen once per owner lifecycle
- Cleanup should always pair with teardown
- The work is not conceptually derived state

### Keep `createEffect` When It Is A Real Bridge

Keep `createEffect` when it synchronizes reactive data to an external imperative sink.

Examples that should remain, though they may be narrowed or split:

- DOM/editor sync in `packages/app/src/components/prompt-input.tsx:690`
- Scroll sync in `packages/app/src/pages/session.tsx:685`
- Scroll/hash sync in `packages/app/src/pages/session/use-session-hash-scroll.ts:149`
- External sync in:
  - `packages/app/src/context/language.tsx:207`
  - `packages/app/src/context/settings.tsx:110`
  - `packages/app/src/context/sdk.tsx:26`
- Polling in:
  - `packages/app/src/components/status-popover.tsx:59`
  - `packages/app/src/components/dialog-select-server.tsx:273`

Rules:

- Keep the effect single-purpose
- Make dependencies explicit and narrow
- Avoid writing back into the same reactive graph unless absolutely required

## Implementation Plan

### Phase 0: Classification Pass

Before changing code, tag each targeted effect as one of: derive, reset, event, lifecycle, or external bridge.

Acceptance criteria:

- Every targeted effect in this spec is tagged with a replacement strategy before refactoring starts
- Shared helpers to be introduced are identified up front to avoid repeating patterns

### Phase 1: Derived-State Cleanup

Tackle highest-value, lowest-risk derived-state cleanup first.

Priority items:

- Normalize tabs at write boundaries and remove `packages/app/src/pages/session.tsx:141`
- Stop syncing `workspaceOrder` in `packages/app/src/pages/layout.tsx:557`
- Make prompt slash filtering reactive so `packages/app/src/components/prompt-input.tsx:652` can be removed
- Replace other obvious derived-state effects in terminal and session header

Acceptance criteria:

- No behavior change in tab ordering, prompt filtering, terminal display, or header state
- Targeted derived-state effects are deleted, not just moved

### Phase 2: Keyed Reset Cleanup

Replace reset-on-key effects with keyed ownership boundaries.

Priority items:

- Key session-scoped UI and state by `sessionKey`
- Key file-scoped state by `scope()`
- Remove manual clear-and-reseed effects in session and file context

Acceptance criteria:

- Switching session or file scope recreates the intended local state cleanly
- No stale state leaks across session or scope changes
- Target reset effects are deleted

### Phase 3: Event-Driven Work Extraction

Move event-driven work out of reactive effects.

Priority items:

- Replace `globalStore.reload` effect dispatching with direct calls
- Split mixed-responsibility effect in `packages/app/src/pages/layout.tsx:1489`
- Collapse duplicated imperative trigger triplets into single functions
- Move file-tree and terminal-panel imperative work to explicit handlers

Acceptance criteria:

- User-triggered behavior still fires exactly once per intended action
- No effect remains whose only job is to notice a command-like state and trigger an imperative function

### Phase 4: Context Ownership Cleanup

Remove mirrored child-store hydration patterns.

Priority items:

- Remove child-store hydration mirrors in `packages/app/src/context/global-sync/child-store.ts:184`, `:190`, `:193`
- Simplify mirror logic in `packages/app/src/context/global-sync.tsx:130`, `:138`
- Revisit `packages/app/src/context/layout.tsx:424` if it still mirrors instead of deriving

Acceptance criteria:

- There is one clear source of truth for each synced value
- Child stores no longer need effect-based hydration to stay consistent
- Initialization and updates both work without manual mirror effects

### Phase 5: Cleanup And Keeper Review

Clean up remaining targeted hotspots and narrow the effects that should stay.

Acceptance criteria:

- Remaining `createEffect` calls in touched files are all true bridges or clearly justified lifecycle sync
- Mixed-responsibility effects are split into smaller units where still needed

## Detailed Work Items By Area

### 1. Normalize Tab State

Files:

- `packages/app/src/pages/session.tsx:141`

Work:

- Move tab normalization into the functions that create, load, or update tab state
- Make readers consume already-normalized tab data
- Remove the effect that rewrites derived tab state after the fact

Rationale:

- Tabs should become valid when written, not be repaired later
- This removes a feedback loop and makes state easier to trust

Acceptance criteria:

- The effect at `packages/app/src/pages/session.tsx:141` is removed
- Newly created and restored tabs are normalized before they enter local state
- Tab rendering still matches current behavior for valid and edge-case inputs

### 2. Key Session-Owned State

Files:

- `packages/app/src/pages/session.tsx:325`
- `packages/app/src/pages/session.tsx:336`
- `packages/app/src/pages/session.tsx:477`
- `packages/app/src/pages/session.tsx:869`
- `packages/app/src/pages/session.tsx:963`
- `packages/app/src/pages/session/message-timeline.tsx:149`

Work:

- Identify state that should reset when `sessionKey` changes
- Move that state under a keyed subtree or keyed owner boundary
- Remove effects that watch `sessionKey` just to clear local state, refs, or temporary UI flags

Rationale:

- Session identity already defines the lifetime of this UI state
- Keyed ownership makes reset behavior automatic and easier to reason about

Acceptance criteria:

- The targeted reset effects are removed
- Changing sessions resets only the intended session-local state
- Scroll and editor state that should persist are not accidentally reset

### 3. Derive Workspace Order

Files:

- `packages/app/src/pages/layout.tsx:557`

Work:

- Stop writing `workspaceOrder` from live workspace data in an effect
- Represent user overrides separately from live workspace data
- Compute effective order from current data plus overrides with a memo or pure helper

Rationale:

- Persisted user intent and live source data should not mirror each other through an effect
- A computed effective order avoids drift and racey resync behavior

Acceptance criteria:

- The effect at `packages/app/src/pages/layout.tsx:557` is removed
- Workspace order updates correctly when workspaces appear, disappear, or are reordered by the user
- User overrides persist without requiring a sync-back effect

### 4. Remove Child-Store Mirrors

Files:

- `packages/app/src/context/global-sync.tsx:130`
- `packages/app/src/context/global-sync.tsx:138`
- `packages/app/src/context/global-sync.tsx:148`
- `packages/app/src/context/global-sync/child-store.ts:184`
- `packages/app/src/context/global-sync/child-store.ts:190`
- `packages/app/src/context/global-sync/child-store.ts:193`
- `packages/app/src/context/layout.tsx:424`

Work:

- Trace the actual ownership of global and child store values
- Replace hydration and mirror effects with explicit initialization and direct updates
- Remove the `globalStore.reload` event-bus pattern and call the needed reload paths directly

Rationale:

- Mirrors make it hard to tell which state is authoritative
- Event-bus style state toggles hide control flow and create accidental reruns

Acceptance criteria:

- Child store hydration no longer depends on effect-based copying
- Reload work can be followed from the event source to the handler without a reactive relay
- State remains correct on first load, child creation, and subsequent updates

### 5. Key File-Scoped State

Files:

- `packages/app/src/context/file.tsx:100`

Work:

- Move file-scoped local state under a boundary keyed by `scope()`
- Remove any effect that watches `scope()` only to reset file-local state

Rationale:

- File scope changes are identity changes
- Keyed ownership gives a cleaner reset than manual clear logic

Acceptance criteria:

- The effect at `packages/app/src/context/file.tsx:100` is removed
- Switching scopes resets only scope-local state
- No previous-scope data appears after a scope change

### 6. Split Layout Side Effects

Files:

- `packages/app/src/pages/layout.tsx:1489`
- Related event-driven effects near `packages/app/src/pages/layout.tsx:484`, `:652`, `:776`, `:1519`

Work:

- Break the mixed-responsibility effect at `:1489` into direct actions and smaller bridge effects only where required
- Move user-triggered branches into the actual command or handler that causes them
- Remove any branch that only exists because one effect is handling unrelated concerns

Rationale:

- Mixed effects hide cause and make reruns hard to predict
- Smaller units reduce accidental coupling and make future cleanup safer

Acceptance criteria:

- The effect at `packages/app/src/pages/layout.tsx:1489` no longer mixes unrelated responsibilities
- Event-driven branches execute from direct handlers
- Remaining effects in this area each have one clear external sync purpose

### 7. Remove Duplicate Triggers

Files:

- `packages/app/src/pages/session/review-tab.tsx:122`
- `packages/app/src/pages/session/review-tab.tsx:130`
- `packages/app/src/pages/session/review-tab.tsx:138`
- `packages/app/src/pages/session/file-tabs.tsx:367`
- `packages/app/src/pages/session/file-tabs.tsx:378`
- `packages/app/src/pages/session/file-tabs.tsx:389`
- `packages/app/src/pages/session/use-session-hash-scroll.ts:144`
- `packages/app/src/pages/session/use-session-hash-scroll.ts:149`
- `packages/app/src/pages/session/use-session-hash-scroll.ts:167`

Work:

- Extract one explicit imperative function per behavior
- Call that function from each source event instead of replicating the same effect pattern multiple times
- Preserve the scroll-sync effect that is truly syncing with the DOM, but remove duplicate trigger scaffolding around it

Rationale:

- Duplicate triggers make it easy to miss a case or fire twice
- One named action is easier to test and reason about

Acceptance criteria:

- Repeated imperative effect triplets are collapsed into shared functions
- Scroll behavior still works, including hash-based navigation
- No duplicate firing is introduced

### 8. Make Prompt Filtering Reactive

Files:

- `packages/app/src/components/prompt-input.tsx:652`
- Keep `packages/app/src/components/prompt-input.tsx:690` as needed

Work:

- Convert slash filtering into a pure reactive derivation from the current input and candidate command list
- Keep only the editor or DOM bridge effect if it is still needed for imperative syncing

Rationale:

- Filtering is classic derived state
- It should not need an effect if it can be computed from current inputs

Acceptance criteria:

- The effect at `packages/app/src/components/prompt-input.tsx:652` is removed
- Filtered slash-command results update correctly as the input changes
- The editor sync effect at `:690` still behaves correctly

### 9. Clean Up Smaller Derived-State Cases

Files:

- `packages/app/src/components/terminal.tsx:261`
- `packages/app/src/components/session/session-header.tsx:309`

Work:

- Replace effect-written local state with memos or inline derivation
- Remove intermediate setters when the value can be computed directly

Rationale:

- These are low-risk wins that reinforce the same pattern
- They also help keep follow-up cleanup consistent

Acceptance criteria:

- Targeted effects are removed
- UI output remains unchanged under the same inputs

## Verification And Regression Checks

Run focused checks after each phase, not only at the end.

### Suggested Verification

- Switch between sessions rapidly and confirm local session UI resets only where intended
- Open, close, and reorder tabs and confirm order and normalization remain stable
- Change workspaces, reload workspace data, and verify effective ordering is correct
- Change file scope and confirm stale file state does not bleed across scopes
- Trigger layout actions that previously depended on effects and confirm they still fire once
- Use slash commands in the prompt and verify filtering updates as you type
- Test review tab, file tab, and hash-scroll flows for duplicate or missing triggers
- Verify global sync initialization, reload, and child-store creation paths

### Regression Checks

- No accidental infinite reruns
- No double-firing network or command actions
- No lost cleanup for listeners, timers, or scroll handlers
- No preserved stale state after identity changes
- No removed effect that was actually bridging to DOM or an external API

If available, add or update tests around pure helpers introduced during this cleanup.

Favor tests for derived ordering, normalization, and action extraction, since those are easiest to lock down.

## Definition Of Done

This work is done when all of the following are true:

- The highest-leverage targets in this spec are implemented
- Each removed effect has been replaced by a clearer pattern: memo, keyed boundary, direct action, or lifecycle hook
- The "should remain" effects still exist only where they serve a real external sync purpose
- Touched files have fewer mixed-responsibility effects and clearer ownership of state
- Manual verification covers session switching, file scope changes, workspace ordering, prompt filtering, and reload flows
- No behavior regressions are found in the targeted areas

A reduced raw `createEffect` count is helpful, but it is not the main success metric.

The main success metric is clearer ownership and fewer effect-driven state repairs.

## Risks And Rollout Notes

Main risks:

- Keyed remounts can reset too much if state boundaries are drawn too high
- Store mirror removal can break initialization order if ownership is not mapped first
- Moving event work out of effects can accidentally skip triggers that were previously implicit

Rollout notes:

- Land in small phases, with each phase keeping the app behaviorally stable
- Prefer isolated PRs by phase or by file cluster, especially for context-store changes
- Review each remaining effect in touched files and leave it only if it clearly bridges to something external
