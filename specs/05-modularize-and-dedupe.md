## Component modularity

Split mega-components and dedupe scoped caches

---

### Summary

Several large UI files combine rendering, state, persistence, and caching patterns, including repeated “scoped session cache” infrastructure. We’ll extract reusable primitives and break large components into smaller units without changing user-facing behavior.

---

### Goals

- Reduce complexity in:
  - `packages/app/src/pages/session.tsx`
  - `packages/app/src/pages/layout.tsx`
  - `packages/app/src/components/prompt-input.tsx`
- Deduplicate “scoped session cache” logic into a shared utility
- Make performance fixes (eviction, throttling) easier to implement safely

---

### Non-goals

- Large redesign of routing or page structure
- Moving to a different state management approach
- Rewriting all contexts in one pass

---

### Current state

- Session page is large and mixes concerns (`packages/app/src/pages/session.tsx`).
- Layout is also large and likely coordinates multiple global concerns (`packages/app/src/pages/layout.tsx`).
- Prompt input is large and includes persistence and interaction logic (`packages/app/src/components/prompt-input.tsx`).
- Similar “scoped cache” patterns appear in multiple places (session-bound maps, per-session stores, ad hoc memoization).

---

### Proposed approach

- Introduce a shared “scoped store” utility to standardize session-bound caches:
  - keyed by `sessionId`
  - automatic cleanup via TTL or explicit `dispose(sessionId)`
  - optional LRU cap for many sessions
- Break mega-components into focused modules with clear boundaries:
  - “view” components (pure rendering)
  - “controller” hooks (state + effects)
  - “services” (SDK calls, persistence adapters)

---

### Phased implementation steps

1. Inventory and name the repeated pattern

- Identify the repeated “scoped session cache” usage sites in:
  - `packages/app/src/pages/session.tsx`
  - `packages/app/src/pages/layout.tsx`
  - `packages/app/src/components/prompt-input.tsx`
- Write down the common operations (get-or-create, clear-on-session-change, dispose).

2. Add a shared scoped-cache utility

- Create `packages/app/src/utils/scoped-cache.ts`:
  - `createScopedCache(createValue, opts)` returning `get(key)`, `peek(key)`, `delete(key)`, `clear()`
  - optional TTL + LRU caps to avoid leak-by-design
- Keep the API tiny and explicit so call sites stay readable.

Sketch:

```ts
type ScopedOpts = { maxEntries?: number; ttlMs?: number }

function createScopedCache<T>(createValue: (key: string) => T, opts: ScopedOpts) {
  // store + eviction + dispose hooks
}
```

3. Extract session page submodules

- Split `packages/app/src/pages/session.tsx` into:
  - `session/view.tsx` for rendering layout
  - `session/messages.tsx` for message list
  - `session/composer.tsx` for input wiring
  - `session/scroll-spy.ts` for active message tracking
- Keep exports stable so routing code changes minimally.

4. Extract layout coordination logic

- Split `packages/app/src/pages/layout.tsx` into:
  - shell layout view
  - navigation/controller logic
  - global keyboard shortcuts (if present)
- Ensure each extracted piece has a narrow prop surface and no hidden globals.

5. Extract prompt-input state machine

- Split `packages/app/src/components/prompt-input.tsx` into:
  - `usePromptComposer()` hook (draft, submission, attachments)
  - presentational input component
- Route persistence through existing `packages/app/src/context/prompt.tsx`, but isolate wiring code.

6. Replace ad hoc scoped caches with the shared utility

- Swap one call site at a time and keep behavior identical.
- Add a flag `scopedCache.shared` to fall back to the old implementation if needed.

---

### Data migration / backward compatibility

- No persisted schema changes are required by modularization alone.
- If any cache keys change due to refactors, keep a compatibility reader for one release cycle.

---

### Risk + mitigations

- Risk: refactors cause subtle behavior changes (focus, keyboard shortcuts, scroll position).
  - Mitigation: extract without logic changes first, then improve behavior in later diffs.
- Risk: new shared cache introduces lifecycle bugs.
  - Mitigation: require explicit cleanup hooks and add dev assertions for retained keys.
- Risk: increased file count makes navigation harder temporarily.
  - Mitigation: use consistent naming and keep the folder structure shallow.

---

### Validation plan

- Manual regression checklist:
  - compose, attach images, submit, and reload draft
  - navigate between sessions and confirm caches don’t bleed across IDs
  - verify terminal, file search, and scroll-spy still behave normally
- Add lightweight unit tests for `createScopedCache` eviction and disposal behavior.

---

### Rollout plan

- Phase 1: introduce `createScopedCache` unused, then adopt in one low-risk area.
- Phase 2: extract session submodules with no behavior changes.
- Phase 3: flip remaining scoped caches to shared utility behind `scopedCache.shared`.
- Phase 4: remove old duplicated implementations after confidence.

---

### Open questions

- Where exactly is “scoped session cache” duplicated today, and what are the differing lifecycle rules?
- Which extracted modules must remain synchronous for Solid reactivity to behave correctly?
- Are there implicit dependencies in the large files (module-level state) that need special handling?
