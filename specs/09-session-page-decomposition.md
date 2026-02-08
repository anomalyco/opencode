## Session page decomposition

Split `pages/session.tsx` into focused modules without behavior changes.

---

### Summary

`packages/app/src/pages/session.tsx` is still a large (~3,655 LOC) route coordinator. Recent refactoring already extracted `packages/app/src/pages/session/helpers.ts` and `packages/app/src/pages/session/scroll-spy.ts`, but review-panel wiring, message timeline orchestration, file-tab rendering, and terminal coordination remain tightly coupled. This spec continues the decomposition from that updated baseline.

---

### Goals

- Reduce complexity in `packages/app/src/pages/session.tsx`.
- Isolate major concerns into dedicated modules under `packages/app/src/pages/session/`.
- Keep behavior and route/API contracts unchanged.
- Preserve current keyboard, scroll, hash, and review interactions.

---

### Non-goals

- No redesign of session UX.
- No changes to SDK contracts.
- No refactor of `context/global-sync.tsx`, `context/file.tsx`, or `components/prompt-input.tsx` in this workstream.

---

### Parallel ownership (important)

This workstream owns:

- `packages/app/src/pages/session.tsx`
- New files under `packages/app/src/pages/session/**`

This workstream must not edit:

- `packages/app/src/pages/layout.tsx` (owned by spec 10)
- `packages/app/src/components/prompt-input.tsx` (owned by spec 11)
- `packages/app/src/context/global-sync.tsx` (owned by spec 12)
- `packages/app/src/context/file.tsx` (owned by spec 13)

---

### Current state

- File size: ~3,655 LOC.
- Existing extracted modules:
  - `packages/app/src/pages/session/helpers.ts` (terminal focus and shared handlers)
  - `packages/app/src/pages/session/scroll-spy.ts` (message visibility + active-section tracking)
- High effect density (`createEffect`) and local-state density (`createStore` + `createSignal`) remain in `session.tsx`.
- Remaining interleaved responsibilities:
  - review panel state + scrolling integration
  - message timeline + hash navigation wiring
  - file tab renderers + per-tab scroll sync
  - terminal panel and tab coordination

---

### Proposed module split

Build on the existing `packages/app/src/pages/session/` directory and keep current extracted helpers in place. Add modules such as:

- `review-panel.tsx` - review tab rendering and focused diff logic.
- `message-timeline.tsx` - session turn rendering and active message tracking UI wiring.
- `file-tabs.tsx` - file tab content rendering, file scroll persistence, and line-comment overlays.
- `terminal-panel.tsx` - terminal tabs and focus behavior.
- `use-session-page-state.ts` - page-level derived state and imperative handlers.

`packages/app/src/pages/session.tsx` remains the route entry and orchestrator only.

---

### Phased steps

1. Keep `helpers.ts` and `scroll-spy.ts` as baseline; extract any additional pure helpers first (no behavior changes).
2. Extract review panel subtree and related handlers.
3. Extract file-tab subtree and scroll synchronization logic.
4. Extract terminal panel subtree.
5. Move page-level state/effects into `use-session-page-state.ts`.
6. Reduce `session.tsx` to composition and routing glue.

---

### Acceptance criteria

- `packages/app/src/pages/session.tsx` is reduced substantially (target: under 1,400 LOC).
- No user-facing behavior changes in session, review, file tabs, or terminal tabs.
- Event listeners and observers are still correctly cleaned up.
- New modules have clear prop boundaries and minimal hidden coupling.

---

### Validation plan

- Typecheck: `bun run typecheck` (from `packages/app`).
- Targeted e2e checks:
  - `e2e/session/session.spec.ts`
  - `e2e/files/file-viewer.spec.ts`
  - `e2e/terminal/terminal.spec.ts`
- Manual checks:
  - message hash navigation
  - review diff focus + open-file action
  - terminal tab create/reorder/focus behavior

---

### Handoff notes

- Keep module interfaces narrow and data-oriented.
- Prefer extracting code unchanged before doing any cleanup refactors.
- If a helper is useful to other specs, place it under `pages/session/` for now; cross-spec shared utilities can be unified later.
