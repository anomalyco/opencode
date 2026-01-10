## Spy acceleration

Replace O(N) DOM scans in session view

---

### Summary

The session scroll-spy currently scans the DOM with `querySelectorAll` and walks message nodes, which becomes expensive as message count grows. We’ll replace the scan with an observer-based or indexed approach that scales smoothly.

---

### Goals

- Remove repeated full DOM scans during scroll in the session view
- Keep “current message” tracking accurate during streaming and layout shifts
- Provide a safe fallback path for older browsers and edge cases

---

### Non-goals

- Visual redesign of the session page
- Changing message rendering structure or IDs
- Perfect accuracy during extreme layout thrash

---

### Current state

- `packages/app/src/pages/session.tsx` uses `querySelectorAll('[data-message-id]')` for scroll-spy.
- The page is large and handles many responsibilities, increasing the chance of perf regressions.

---

### Proposed approach

Implement a two-tier scroll-spy:

- Primary: `IntersectionObserver` to track which message elements are visible, updated incrementally.
- Secondary: binary search over precomputed offsets when observer is unavailable or insufficient.
- Use `ResizeObserver` (and a lightweight “dirty” flag) to refresh offsets only when layout changes.

---

### Phased implementation steps

1. Extract a dedicated scroll-spy module

- Create `packages/app/src/pages/session/scroll-spy.ts` (or similar) that exposes:
  - `register(el, id)` and `unregister(id)`
  - `getActiveId()` signal/store
- Keep DOM operations centralized and easy to profile.

2. Add IntersectionObserver tracking

- Observe each `[data-message-id]` element once, on mount.
- Maintain a small map of `id -> intersectionRatio` (or visible boolean).
- Pick the active id by:
  - highest intersection ratio, then
  - nearest to top of viewport as a tiebreaker

3. Add binary search fallback

- Maintain an ordered list of `{ id, top }` positions.
- On scroll (throttled via `requestAnimationFrame`), compute target Y and binary search to find nearest message.
- Refresh the positions list on:
  - message list mutations (new messages)
  - container resize events (ResizeObserver)
  - explicit “layout changed” events after streaming completes

4. Remove `querySelectorAll` hot path

- Keep a one-time initial query only as a bridge during rollout, then remove it.
- Ensure newly rendered messages are registered via refs rather than scanning the whole DOM.

5. Add a feature flag and fallback

- Add `session.scrollSpyOptimized` flag.
- If observer setup fails, fall back to the existing scan behavior temporarily.

---

### Data migration / backward compatibility

- No persisted data changes.
- IDs remain sourced from existing `data-message-id` attributes.

---

### Risk + mitigations

- Risk: observer ordering differs from previous “active message” logic.
  - Mitigation: keep selection rules simple, document them, and add a small tolerance for tie cases.
- Risk: layout shifts cause incorrect offset indexing.
  - Mitigation: refresh offsets with ResizeObserver and after message streaming batches.
- Risk: performance regressions from observing too many nodes.
  - Mitigation: prefer one observer instance and avoid per-node observers.

---

### Validation plan

- Manual scenarios:
  - very long sessions (hundreds of messages) and continuous scrolling
  - streaming responses that append content and change heights
  - resizing the window and toggling side panels
- Add a dev-only profiler hook to log time spent in scroll-spy updates per second.

---

### Rollout plan

- Land extracted module first, still using the old scan internally.
- Add observer implementation behind `session.scrollSpyOptimized` off by default.
- Enable flag for internal testing, then default on after stability.
- Keep fallback code for one release cycle, then remove scan path.

---

### Open questions

- What is the exact definition of “active” used elsewhere (URL hash, sidebar highlight, breadcrumb)?
- Are messages virtualized today, or are all DOM nodes mounted at once?
- Which container is the scroll root (window vs an inner div), and does it change by layout mode?
