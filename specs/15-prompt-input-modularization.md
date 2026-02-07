## Prompt input split

Modularize `prompt-input.tsx` without behavior changes

---

### Summary

`packages/app/src/components/prompt-input.tsx` is a very large component that combines editor DOM parsing, popovers, history, drag/drop + paste uploads, worktree/session creation, optimistic messages, and send/abort flow. This spec splits it into focused modules so future changes are safer.

---

### Goals

- Reduce `prompt-input.tsx` complexity and file size
- Extract cohesive logic into testable hooks/helpers
- Keep runtime behavior and UX unchanged

---

### Non-goals

- Replacing contenteditable editor approach
- Major UX redesign of composer controls
- API contract changes for prompt submission

---

### Parallel execution contract

This spec owns:

- `packages/app/src/components/prompt-input.tsx`
- New files under `packages/app/src/components/prompt-input/*`

This spec should not modify:

- `packages/app/src/pages/session.tsx`
- `packages/app/src/context/prompt.tsx` (except minor type-only imports if needed)

---

### Implementation plan

1. Extract editor DOM helpers

- Move pure DOM/selection helpers into `prompt-input/editor-dom.ts`:
  - `createTextFragment`
  - `getNodeLength`
  - `getTextLength`
  - cursor get/set helpers

2. Extract history controller

- Move prompt history read/write/navigation logic into `prompt-input/history.ts` hook.
- Keep existing persisted keys and history semantics unchanged.

3. Extract attachment interactions

- Move image/file paste + drag/drop + file-input attachment flows to `prompt-input/attachments.ts` hook.

4. Extract submit pipeline

- Move send/abort/optimistic message pipeline to `prompt-input/submit.ts` service/hook.
- Keep existing error toasts, worktree handling, and rollback behavior.

5. Keep composition shell stable

- `PromptInput` component remains the integration shell that wires hooks + JSX.
- Preserve exported component API and props.

---

### Acceptance criteria

- `prompt-input.tsx` becomes primarily orchestration + view code.
- Extracted modules contain the heavy imperative logic.
- All existing behaviors remain intact:
  - slash and @ popovers
  - history up/down navigation
  - image attach/paste/drag-drop
  - shell mode submit/abort
  - optimistic message + rollback on failure

---

### Validation plan

- Manual regression checklist:
  - type prompt, submit, stop, retry
  - use `/` command selection and `@` selector
  - history navigation with arrows
  - paste image, drag image, remove attachment
  - start in new session + worktree create path
  - failure path restores prompt and context comments

---

### Risks and mitigations

- Risk: subtle ordering changes in submit rollback logic.
  - Mitigation: migrate logic mechanically first, then cleanup.
- Risk: editor selection bugs after helper extraction.
  - Mitigation: keep existing cursor helpers unchanged and add focused manual checks.
