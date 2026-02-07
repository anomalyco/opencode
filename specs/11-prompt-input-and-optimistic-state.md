## Prompt input and optimistic-state consolidation

Decompose prompt-input and unify optimistic message mutations.

---

### Summary

`packages/app/src/components/prompt-input.tsx` has already been partially decomposed and is now ~1,391 LOC. Editor DOM helpers, attachments, history, and submit flow were extracted into `packages/app/src/components/prompt-input/*.ts`, but optimistic mutation ownership and some UI/controller responsibilities are still split across call sites. This spec continues from that refactored baseline.

---

### Goals

- Split `prompt-input.tsx` into modular UI + controller pieces.
- Centralize optimistic message add/remove behavior behind sync-context APIs.
- Remove unsafe cast path around optimistic parts (`as unknown as Part[]`).
- Keep existing prompt UX and submission semantics unchanged.

---

### Non-goals

- No redesign of prompt input visuals.
- No changes to session protocol or backend APIs.
- No changes to unrelated page modules (`pages/session.tsx`, `pages/layout.tsx`).

---

### Parallel ownership (important)

This workstream owns:

- `packages/app/src/components/prompt-input.tsx`
- New files under `packages/app/src/components/prompt-input/**`
- `packages/app/src/context/sync.tsx` (optimistic API surface only)

This workstream must not edit:

- `packages/app/src/pages/session.tsx` (spec 09)
- `packages/app/src/pages/layout.tsx` (spec 10)
- `packages/app/src/context/global-sync.tsx` (spec 12)
- `packages/app/src/context/file.tsx` (spec 13)

---

### Current state

- File size: ~1,391 LOC for `prompt-input.tsx`.
- Existing extracted modules:
  - `prompt-input/editor-dom.ts`
  - `prompt-input/attachments.ts`
  - `prompt-input/history.ts`
  - `prompt-input/submit.ts`
- Optimistic mutation and request-part casting still need consolidation (including remaining `as unknown as Part[]` in submit path).
- Remaining concerns still tightly coupled in `prompt-input.tsx`:
  - slash/mention UI rendering and keyboard orchestration
  - context pill interactions and focus behavior
  - composition glue across history/attachments/submit

---

### Proposed structure

Build on the existing `packages/app/src/components/prompt-input/` modules by adding/further splitting modules such as:

- `use-prompt-composer.ts` - state machine for submit/abort/history.
- `build-request-parts.ts` - typed request-part construction.
- `slash-popover.tsx` - slash command list rendering.
- `context-items.tsx` - context pills and interactions.

Keep existing lower-level modules (`attachments.ts`, `editor-dom.ts`, `history.ts`, `submit.ts`) and narrow their responsibilities where needed.

Add sync-level optimistic APIs (in `context/sync.tsx` or `context/sync-optimistic.ts`):

- `session.optimistic.add(...)`
- `session.optimistic.remove(...)`

Prompt input should call these APIs instead of directly mutating message/part stores.

---

### Phased steps

1. Extract typed request-part builder (likely from `prompt-input/submit.ts`) to remove ad hoc casting.
2. Introduce sync optimistic APIs with current behavior.
3. Replace remaining direct `produce(...)` optimistic mutations with optimistic APIs.
4. Extract remaining UI subtrees (slash popover, context items, toolbar controls).
5. Extract controller hook and keep route component as composition shell.

---

### Acceptance criteria

- Optimistic update logic exists in one place only.
- `prompt-input.tsx` is significantly smaller (target: under 1,200 LOC).
- Prompt submit/abort/history behavior remains unchanged.
- No `as unknown as Part[]` in optimistic request construction path.

---

### Validation plan

- Typecheck: `bun run typecheck` (from `packages/app`).
- Targeted e2e checks:
  - `e2e/prompt/prompt.spec.ts`
  - `e2e/prompt/context.spec.ts`
  - `e2e/prompt/prompt-slash-open.spec.ts`
  - `e2e/prompt/prompt-mention.spec.ts`
- Manual check:
  - submit with file/image/context attachments
  - abort in-flight turn
  - history up/down restore behavior

---

### Handoff notes

- Preserve sequence semantics around optimistic insert, worktree wait, send, and rollback.
- Keep sync optimistic API data-oriented and reusable by future callers.
- Do not mix this with broader sync/global-sync refactors in the same diff.
