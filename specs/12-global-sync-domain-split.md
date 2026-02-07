## Global sync domain split

Refactor `context/global-sync.tsx` into domain modules while preserving behavior.

---

### Summary

`packages/app/src/context/global-sync.tsx` is a large multi-domain module (1,000+ LOC) that currently owns queue scheduling, bootstrap, child store creation, persistence bridges, session trimming, and event reduction. This workstream splits it into clear domains without changing runtime behavior.

---

### Goals

- Decompose global sync internals into maintainable modules.
- Keep `useGlobalSync()` public API unchanged.
- Isolate pure logic (session trimming, ordering, grouping) from side effects.
- Keep event handling deterministic and easier to test.

---

### Non-goals

- No protocol/API changes to server events.
- No behavior changes in session ordering, trimming, or cache semantics.
- No changes to page-level UI logic.

---

### Parallel ownership (important)

This workstream owns:

- `packages/app/src/context/global-sync.tsx`
- New files under `packages/app/src/context/global-sync/**`

This workstream must not edit:

- `packages/app/src/context/file.tsx` (spec 13)
- `packages/app/src/components/prompt-input.tsx` (spec 11)
- `packages/app/src/pages/session.tsx` and `packages/app/src/pages/layout.tsx` (specs 09/10)

---

### Current state

- Single large module with many responsibilities.
- Event reducer is embedded in component lifecycle code.
- Queue/scheduler, bootstrap, and child-store lifecycle are tightly interwoven.

---

### Proposed module split

Create `packages/app/src/context/global-sync/` modules like:

- `types.ts` - shared types.
- `queue.ts` - refresh queue and drain scheduler.
- `child-store.ts` - child store creation, persistence wiring, cache maps.
- `session-trim.ts` - pure session sorting/trimming helpers.
- `bootstrap.ts` - global and per-directory bootstrap flows.
- `event-reducer.ts` - event handlers for SDK event stream.

Keep `global-sync.tsx` as provider/composition entry point.

---

### Phased steps

1. Extract pure helpers (`cmp`, session trim/recent logic) first.
2. Extract queue/drain scheduler.
3. Extract child-store creation and persisted cache wiring.
4. Extract bootstrap flows.
5. Extract event reducer and wire into existing listener.
6. Keep API surface stable and documented.

---

### Acceptance criteria

- Public API of `useGlobalSync()` remains backward compatible.
- `global-sync.tsx` is substantially reduced (target: under 500 LOC).
- Event handling logic is isolated and easier to trace.
- No behavior regressions in project/session/provider sync.

---

### Validation plan

- Typecheck: `bun run typecheck` (from `packages/app`).
- Targeted e2e checks:
  - `e2e/app/session.spec.ts`
  - `e2e/sidebar/sidebar-session-links.spec.ts`
  - `e2e/projects/projects-switch.spec.ts`
- Manual checks:
  - switching directories/projects still hydrates child stores correctly
  - session list/pagination behavior remains stable

---

### Handoff notes

- Favor function extraction with unchanged code first.
- Keep event handler ordering explicit; avoid implicit fallthrough behaviors.
- Add focused tests only for extracted pure helpers if practical, but avoid broad test-suite changes here.
