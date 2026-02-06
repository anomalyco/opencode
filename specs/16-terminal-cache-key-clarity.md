## Terminal cache scope

Clarify workspace-only terminal cache semantics

---

### Summary

`packages/app/src/context/terminal.tsx` accepts `(dir, session)` but currently keys cache entries as `${dir}:${WORKSPACE_KEY}`. The behavior is workspace-scoped, but the API shape suggests session-scoped caching. This spec aligns naming and implementation to avoid confusion and future bugs.

---

### Goals

- Make terminal cache scope explicit (workspace-scoped)
- Remove misleading unused session-keying surface
- Preserve existing runtime behavior

---

### Non-goals

- Changing terminal persistence behavior
- Moving terminals to per-session isolation
- UI changes to terminal tabs

---

### Parallel execution contract

This spec owns:

- `packages/app/src/context/terminal.tsx`

This spec should not modify:

- `packages/app/src/pages/session.tsx`
- `packages/app/src/components/session/session-sortable-terminal-tab.tsx`

---

### Implementation plan

1. Rename internals for clarity

- Update internal function names/variables from session-oriented to workspace-oriented where applicable.

2. Remove unused session cache-key parametering

- Simplify `load`/factory signatures so keying intent is explicit.
- Keep key format workspace-only by directory.

3. Add inline documentation

- Add short comment near cache key creation clarifying why terminals are shared across sessions in the same workspace.

4. Keep behavior stable

- Ensure active terminal, tab order, clone/new/close behavior remain unchanged.

---

### Acceptance criteria

- No unused session-derived cache key logic remains.
- Code communicates workspace-scoped terminal lifecycle clearly.
- No functional changes to terminal operations.

---

### Validation plan

- Manual:
  - Create multiple terminals, navigate between sessions in same workspace, confirm state continuity.
  - Switch workspace directory, confirm separate terminal state.

---

### Risks and mitigations

- Risk: accidental behavior change to session-scoped terminals.
  - Mitigation: keep cache key unchanged; refactor naming/signatures only.
