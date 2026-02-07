## Runtime adapter type safety

Reduce unsafe casts at browser and third-party integration boundaries.

---

### Summary

Several integration points rely on `as any` or `unknown as` casts (terminal internals, speech recognition, add-on internals, generic trigger props). This spec introduces typed adapters and narrow interfaces to improve maintainability and make type errors actionable.

---

### Goals

- Remove or significantly reduce unsafe casts in scoped files.
- Introduce explicit adapter interfaces around unstable third-party APIs.
- Preserve behavior with no UX changes.
- Improve maintainability of terminal and speech integrations.

---

### Non-goals

- No server health dedupe work (owned by spec 14).
- No large architectural changes to terminal or speech subsystems.
- No changes to business logic semantics.

---

### Parallel ownership (important)

This workstream owns:

- `packages/app/src/components/terminal.tsx`
- `packages/app/src/utils/speech.ts`
- `packages/app/src/addons/serialize.ts`
- `packages/app/src/components/dialog-select-model.tsx`
- New utility files under `packages/app/src/utils/**` related to adapter typing

This workstream must not edit:

- `components/dialog-select-server.tsx`, `components/status-popover.tsx`, `context/server.tsx` (spec 14)
- `components/prompt-input.tsx` (spec 11)

---

### Current state

- Explicit `as any` appears in `serialize.ts` and `speech.ts`.
- Multiple `unknown as` casts in `terminal.tsx` for option/disposable access.
- Generic trigger props in `dialog-select-model.tsx` use `as any` spread.

---

### Proposed approach

1. Add narrow adapter types for third-party internals:

- terminal option setter/disposable handles
- speech recognition constructor on `window`
- serialize addon internal terminal buffer access

2. Introduce tiny helper guards/utilities:

- `isDisposable(value): value is { dispose(): void }`
- `hasSetOption(value): value is { setOption(...): void }`

3. Replace broad casts with adapter functions and runtime checks.

---

### Phased steps

1. Refactor terminal helpers (`setOption`, disposal cleanups) to typed guards.
2. Refactor speech recognition window access to typed constructor lookup.
3. Replace `serialize.ts` `as any` internals with explicit local interface.
4. Remove `dialog-select-model.tsx` `as any` trigger props cast via stricter generic typing.

---

### Acceptance criteria

- No `as any` remains in the scoped files (or document unavoidable cases inline).
- `unknown as` usage in scoped files is minimized and justified.
- Typecheck passes with no new suppression comments.
- Runtime behavior remains unchanged.

---

### Validation plan

- Typecheck: `bun run typecheck` (from `packages/app`).
- Targeted e2e checks:
  - `e2e/terminal/terminal.spec.ts`
  - `e2e/models/model-picker.spec.ts`
- Manual checks:
  - terminal open/connect/resize/cleanup
  - speech start/stop and interim/final behavior

---

### Handoff notes

- Prefer small typed wrapper functions over inline complex narrowing.
- Keep adapter names explicit and local to their integration point.
- If a cast cannot be removed safely, add a short comment describing why.
