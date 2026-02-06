## Layout page decomposition

Split `pages/layout.tsx` into composable layout modules with stable behavior.

---

### Summary

`packages/app/src/pages/layout.tsx` is a 3,000+ line coordinator for sidebar navigation, project/workspace controls, deep-link handling, dialogs, drag/drop overlays, and global shell interactions. This spec decomposes it into focused modules to improve maintainability and reduce merge risk for future features.

---

### Goals

- Break up `packages/app/src/pages/layout.tsx` into smaller units.
- Separate rendering concerns from orchestration/state concerns.
- Keep existing URL/navigation semantics and sidebar behavior.
- Preserve all current command and dialog entry points.

---

### Non-goals

- No major UX redesign of the sidebar or project/workspace UI.
- No changes to server/global-sync contracts.
- No refactor of `pages/session.tsx` in this workstream.

---

### Parallel ownership (important)

This workstream owns:

- `packages/app/src/pages/layout.tsx`
- New files under `packages/app/src/pages/layout/**`

This workstream must not edit:

- `packages/app/src/pages/session.tsx` (spec 09)
- `packages/app/src/components/prompt-input.tsx` (spec 11)
- `packages/app/src/context/global-sync.tsx` (spec 12)

---

### Current state

- File size: ~3,004 LOC.
- Contains mixed concerns:
  - app-shell rendering
  - sidebar/project/workspace UI + drag/drop
  - deep-link handling and startup flows
  - workspace reset/delete actions and toasts

---

### Proposed module split

Create `packages/app/src/pages/layout/` modules such as:

- `use-layout-page-state.ts` - orchestration state and handlers.
- `sidebar-panel.tsx` - sidebar shell and root interactions.
- `project-item.tsx` - project-level row and actions.
- `workspace-item.tsx` - workspace row, sessions list, and workspace actions.
- `deep-links.ts` - deep-link parsing/draining/handler utilities.

Keep `packages/app/src/pages/layout.tsx` as route-level composition and provider wiring.

---

### Phased steps

1. Extract pure helpers first (deep-link parse, shared label helpers, small utility functions).
2. Extract workspace subtree and action handlers.
3. Extract project subtree and menu actions.
4. Extract sidebar shell and drag overlay components.
5. Move orchestration logic into `use-layout-page-state.ts`.
6. Reduce `layout.tsx` to composition-only entry.

---

### Acceptance criteria

- `packages/app/src/pages/layout.tsx` is significantly smaller (target: under 1,200 LOC).
- Behavior parity for:
  - project open/close/rename
  - workspace expand/collapse/reset/delete
  - deep-link handling
  - drag/drop ordering
- No regressions in keyboard navigation and dialog actions.

---

### Validation plan

- Typecheck: `bun run typecheck` (from `packages/app`).
- Targeted e2e checks:
  - `e2e/sidebar/sidebar.spec.ts`
  - `e2e/projects/workspaces.spec.ts`
  - `e2e/projects/project-edit.spec.ts`
  - `e2e/app/navigation.spec.ts`
- Manual check: deep-link open-project flow still opens and navigates correctly.

---

### Handoff notes

- Keep action handlers close to their domain module.
- Do not merge in behavior cleanups during extraction; preserve semantics first.
- If shared components are needed, add them under `pages/layout/` for now to avoid cross-spec conflicts.
