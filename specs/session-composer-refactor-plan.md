# Session Composer Refactor Plan

## Goal

Improve structure, ownership, and reuse for the bottom-of-session composer area without changing user-visible behavior.

Scope:

- `packages/ui/src/components/dock-prompt.tsx`
- `packages/app/src/components/session-todo-dock.tsx`
- `packages/app/src/components/question-dock.tsx`
- `packages/app/src/pages/session/session-prompt-dock.tsx`
- related shared UI in `packages/app/src/components/prompt-input.tsx`

## Decisions Up Front

1. **`session-prompt-dock` should stay route-scoped.**
   It is session-page orchestration, so it belongs under `pages/session`, not global `src/components`.

2. **The orchestrator should keep blocking ownership.**
   A single component should decide whether to show blockers (`question`/`permission`) or the regular prompt input. This avoids drift and duplicate logic.

3. **Current component does too much.**
   Split state derivation, permission actions, and rendering into smaller units while preserving behavior.

4. **There is style duplication worth addressing.**
   The prompt top shell and lower tray (`prompt-input.tsx`) visually overlap with dock shells/footers and todo containers. We should extract reusable dock surface primitives.

---

## Phase 0 (Mandatory Gate): Baseline E2E Coverage

No refactor work starts until this phase is complete and green locally.

### 0.1 Deterministic test harness

Add a test-only way to put a session into exact dock states, so tests do not rely on model/tool nondeterminism.

Proposed implementation:

- Add a guarded e2e route in backend (enabled only when a dedicated env flag is set by e2e-local runner).
  - New route file: `packages/opencode/src/server/routes/e2e.ts`
  - Mount from: `packages/opencode/src/server/server.ts`
  - Gate behind env flag (for example `OPENCODE_E2E=1`) so this route is never exposed in normal runs.
- Add seed helpers in app e2e layer:
  - `packages/app/e2e/actions.ts` (or `fixtures.ts`) helpers to:
    - seed question request for a session
    - seed permission request for a session
    - seed/update todos for a session
    - clear seeded blockers/todos
- Update e2e-local runner to set the flag:
  - `packages/app/script/e2e-local.ts`

### 0.2 New e2e spec

Create a focused spec:

- `packages/app/e2e/session/session-composer-dock.spec.ts`

Test matrix (minimum required):

1. **Default prompt dock**
   - no blocker state
   - assert prompt input is visible and focusable
   - assert blocker cards are absent

2. **Blocked question flow**
   - seed question request for session
   - assert question dock renders
   - assert prompt input is not shown/active
   - answer and submit
   - assert unblock and prompt input returns

3. **Blocked permission flow**
   - seed permission request with patterns + optional description
   - assert permission dock renders expected actions
   - assert prompt input is not shown/active
   - test each response path (`once`, `always`, `reject`) across tests
   - assert unblock behavior

4. **Todo dock transitions and collapse behavior**
   - seed todos with `pending`/`in_progress`
   - assert todo dock appears above prompt and can collapse/expand
   - update todos to all completed/cancelled
   - assert close animation path and eventual hide

5. **Keyboard focus behavior while blocked**
   - with blocker active, typing from document context must not focus prompt input
   - blocker actions remain keyboard reachable

Notes:

- Prefer stable selectors (`data-component`, `data-slot`, role/name).
- Extend `packages/app/e2e/selectors.ts` as needed.
- Use `expect.poll` for async transitions.

### 0.3 Gate commands (must pass before Phase 1)

Run from `packages/app` (never from repo root):

```bash
bun test:e2e:local -- e2e/session/session-composer-dock.spec.ts
bun test:e2e:local -- e2e/prompt/prompt.spec.ts e2e/prompt/prompt-multiline.spec.ts e2e/commands/input-focus.spec.ts
bun test:e2e:local
```

If any fail, stop and fix before refactor.

---

## Phase 1: Structural Refactor (No Intended Behavior Changes)

### 1.1 Colocate session-composer files

Create a route-local composer folder:

```txt
packages/app/src/pages/session/composer/
  session-composer-region.tsx      # rename/move from session-prompt-dock.tsx
  session-composer-state.ts        # derived state + actions
  session-permission-dock.tsx      # extracted from inline JSX
  session-question-dock.tsx        # moved from src/components/question-dock.tsx
  session-todo-dock.tsx            # moved from src/components/session-todo-dock.tsx
  index.ts
```

Import updates:

- `packages/app/src/pages/session.tsx` imports `SessionComposerRegion` from `pages/session/composer`.

### 1.2 Split responsibilities

- Keep `session-composer-region.tsx` focused on rendering orchestration:
  - blocker mode vs normal mode
  - relative stacking (todo above prompt)
  - handoff fallback rendering
- Move side-effect/business pieces into `session-composer-state.ts`:
  - derive `questionRequest`, `permissionRequest`, `blocked`, todo visibility state
  - permission response action + in-flight state
  - todo close/open animation state

### 1.3 Remove duplicate blocked logic in `session.tsx`

Current `session.tsx` computes `blocked` independently. Make the composer state the single source for blocker status consumed by both:

- page-level keydown autofocus guard
- composer rendering guard

### 1.4 Keep prompt gating in orchestrator

`session-composer-region` should remain responsible for choosing whether `PromptInput` renders when blocked.

Rationale:

- this is layout-mode orchestration, not prompt implementation detail
- keeps blocker and prompt transitions coordinated in one place

### 1.5 Phase 1 acceptance criteria

- No intentional behavior deltas.
- Phase 0 suite remains green.
- `session-prompt-dock` no longer exists as a large mixed-responsibility component.
- Session composer files are colocated under `pages/session/composer`.

---

## Phase 2: Reuse + Styling Maintainability

### 2.1 Extract shared dock surface primitives

Create reusable shell/tray wrappers to remove repeated visual scaffolding:

- primary elevated surface (prompt top shell / dock body)
- secondary tray surface (prompt bottom bar / dock footer / todo shell)

Proposed targets:

- `packages/ui/src/components` for shared primitives if reused by both app and ui components
- or `packages/app/src/pages/session/composer` first, then promote to ui after proving reuse

### 2.2 Apply primitives to current components

Adopt in:

- `packages/app/src/components/prompt-input.tsx`
- `packages/app/src/pages/session/composer/session-todo-dock.tsx`
- `packages/ui/src/components/dock-prompt.tsx` (where appropriate)

Focus on deduping patterns seen in:

- prompt elevated shell styles (`prompt-input.tsx` form container)
- prompt lower tray (`prompt-input.tsx` bottom panel)
- dock prompt footer/body and todo dock container

### 2.3 De-risk style ownership

- Move dock-specific styling out of overly broad files (for example, avoid keeping new dock-specific rules buried in unrelated message-part styling files).
- Keep slot names stable unless tests are updated in the same PR.

### 2.4 Optional follow-up (if low risk)

Evaluate extracting shared question/permission presentational pieces used by:

- `packages/app/src/pages/session/composer/session-question-dock.tsx`
- `packages/ui/src/components/message-part.tsx`

Only do this if behavior parity is protected by tests and the change is still reviewable.

### 2.5 Phase 2 acceptance criteria

- Reduced duplicated shell/tray styling code.
- No regressions in blocker/todo/prompt transitions.
- Phase 0 suite remains green.

---

## Implementation Sequence (single branch)

1. **Step A - Baseline safety net**
   - Add e2e harness + new session composer dock spec + selector/helpers.
   - Must pass locally before any refactor work proceeds.

2. **Step B - Phase 1 colocation/splitting**
   - Move/rename files, extract state and permission component, keep behavior.

3. **Step C - Phase 1 dedupe blocked source**
   - Remove duplicate blocked derivation and wire page autofocus guard to shared source.

4. **Step D - Phase 2 style primitives**
   - Introduce shared surface primitives and migrate prompt/todo/dock usage.

5. **Step E (optional) - shared question/permission presentational extraction**

---

## Rollback Strategy

- Keep each step logically isolated and easy to revert.
- If regressions occur, revert the latest completed step first and rerun the Phase 0 suite.
- If style extraction destabilizes behavior, keep structural Phase 1 changes and revert only Phase 2 styling commits.
