## Server health and row dedupe

Unify server health checks and deduplicate server-row UI logic.

---

### Summary

Server health logic is duplicated across multiple files, and server row rendering/truncation logic is repeated in both the status popover and server dialog. This creates drift risk and inconsistent behavior. This spec centralizes health checks and row rendering while preserving existing UX.

---

### Goals

- Introduce one shared server-health checker.
- Use consistent timeout and error semantics in all server health call sites.
- Deduplicate repeated server row truncation/tooltip behavior.
- Keep current polling interval and status semantics unless explicitly changed.

---

### Non-goals

- No redesign of the status popover or server dialog.
- No changes to server persistence model.
- No broad refactor of unrelated status tabs (MCP/LSP/plugins).

---

### Parallel ownership (important)

This workstream owns:

- `packages/app/src/components/dialog-select-server.tsx`
- `packages/app/src/components/status-popover.tsx`
- `packages/app/src/context/server.tsx`
- New files under `packages/app/src/components/server/**` and/or `packages/app/src/utils/server-health.ts`

This workstream must not edit:

- `packages/app/src/components/terminal.tsx` (spec 15)
- `packages/app/src/pages/session.tsx` and `packages/app/src/pages/layout.tsx` (specs 09/10)

---

### Current state

- Duplicate `checkHealth` implementation in:
  - `components/dialog-select-server.tsx`
  - `components/status-popover.tsx`
- Similar health check logic in `context/server.tsx`.
- Duplicate row truncation + resize listener logic in status and dialog server lists.

---

### Proposed approach

1. Add shared health utility:

- `checkServerHealth(url, fetch, opts)`
- one timeout strategy
- one return shape: `{ healthy: boolean, version?: string }`

2. Add shared server row primitive:

- common rendering for status dot, truncated name/version handling, tooltip content
- optional action slots for per-screen controls

3. Adopt utility and row primitive in both consumers.

---

### Phased steps

1. Create `utils/server-health.ts` and migrate all health call sites.
2. Create shared row component (`components/server/server-row.tsx`).
3. Replace duplicated row logic in server dialog and status popover.
4. Confirm polling and active/default server behavior still match existing UX.

---

### Acceptance criteria

- Exactly one app-level server health check implementation remains.
- Server row truncation/tooltip behavior is shared, not duplicated.
- No regressions when switching active/default server.
- Existing status dot semantics are preserved.

---

### Validation plan

- Typecheck: `bun run typecheck` (from `packages/app`).
- Targeted e2e checks:
  - `e2e/status/status-popover.spec.ts`
  - `e2e/app/server-default.spec.ts`
- Manual checks:
  - add/edit/remove server
  - blocked unhealthy server behavior
  - default server toggles and persistence

---

### Handoff notes

- Keep shared server row API minimal and composable.
- Avoid introducing new global state for this refactor.
- Prefer deterministic helper behavior over UI-specific branching inside the utility.
