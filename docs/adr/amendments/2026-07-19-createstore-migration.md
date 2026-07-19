# Amendment 2026-07-19 — createStore Migration (Stage 4)

## Context

`packages/app/AGENTS.md` (L20) requires:

> "Always prefer `createStore` over multiple `createSignal` calls"

Prior to this amendment, three Todo Sidebar Feature UI components
still used `createSignal` for local state:

1. `packages/app/src/components/date-picker.tsx` — 3 signals
   (`open`, `view`, `focusDay`).
2. `packages/app/src/components/todo-popover.tsx` — 1 signal (`shown`).
3. `packages/app/src/components/linear-sync-history.tsx` — 3
   module-level signals (`entries`, `isSyncing`, `syncType`) plus a
   top-level `let idCounter = 0` binding.

## Decision

Migrate all three components to `createStore`. Each component's
multiple signals are consolidated into a single store keyed by
field name. The `let idCounter` binding in `linear-sync-history.tsx`
is wrapped into the store to eliminate the top-level `let` (per
AGENTS.md "Avoid `let` where `const` suffices").

## Changes

### `packages/app/src/components/date-picker.tsx`

- Removed `createSignal` from `solid-js` import.
- Added `import { createStore } from "solid-js/store"`.
- Consolidated 3 signals into one store:
  ```typescript
  const [state, setState] = createStore({
    open: false,
    view: initialView(),
    focusDay: props.value ?? toDate(today()),
  })
  ```
- All `open()` → `state.open`; `view()` → `state.view`;
  `focusDay()` → `state.focusDay`.
- Setter calls converted to `setState("key", value)` or
  `setState({ ... })` form.
- `setView({ year, month })` calls now use
  `setState("view", { year, month })` or the spread form
  `setState({ view: { ... } })` depending on whether other fields
  also change in the same call.

### `packages/app/src/components/todo-popover.tsx`

- Removed `createSignal` from `solid-js` import.
- Added `import { createStore } from "solid-js/store"`.
- Single signal `shown` → store:
  ```typescript
  const [state, setState] = createStore({ shown: false })
  ```
- `shown()` → `state.shown`.
- `setShown(next)` → `setState("shown", next)`.
- `setShown((prev) => !prev)` →
  `setState("shown", (prev) => !prev)` (functional updater
  preserved).

### `packages/app/src/components/linear-sync-history.tsx`

- Removed `createSignal` and `Accessor` from `solid-js` import.
- Added `import { createStore } from "solid-js/store"`.
- Consolidated 3 module-level signals + `let idCounter` into one
  module-level store:
  ```typescript
  const [state, setState] = createStore({
    entries: [] as SyncEntry[],
    isSyncing: false,
    syncType: null as "push" | "pull" | null,
    idCounter: 0,
  })

  const nextId = () => {
    setState("idCounter", (n) => n + 1)
    return `sync-${state.idCounter}`
  }
  ```
- `useSyncHistory` return shape: previously returned
  `Accessor<T>` for `entries`/`isSyncing`/`syncType`; now returns
  plain functions `() => state.x` (callers unaffected — they
  already invoke as `entries()` etc.).
- `setEntries((prev) => ...)` → `setState("entries", (prev) => ...)`.
- `setIsSyncing` and `setSyncType` became inline arrows in the
  returned object:
  ```typescript
  setIsSyncing: (v: boolean) => setState("isSyncing", v),
  setSyncType: (v: "push" | "pull" | null) => setState("syncType", v),
  ```

## Why `createStore` over `createSignal`

Per `packages/app/AGENTS.md` L20: a single store with keyed paths
gives better devtools introspection, batches updates, and avoids
the "N signals for N fields" anti-pattern. The migration is
especially valuable for `linear-sync-history.tsx` where 4 separate
bindings (3 signals + 1 let) collapse into one typed store.

## Verification

- `bun --cwd packages/app typecheck` — passes.
- No unit tests for these components (consistent with the rest of
  the UI package — components are exercised via stories / E2E).
- Visual smoke test pending dev-server run (not in scope for this
  amendment — frontend supports hot reload, no backend restart
  needed per workspace rule).

## Relationship to other amendments

- **Stage 3** (effect-schema-migration): kernel-side type-system
  refactor. No overlap with this UI-side amendment.
- **Stage 5** (composer-reuse-refactor): also touches
  `dialog-edit-todo.tsx` (UI), but `dialog-edit-todo.tsx` was
  already using `createStore` before this stage — only the three
  components above needed migration.

## Open questions

None. All `createSignal` usages in the Todo Sidebar Feature scope
have been migrated; `createSignal` no longer appears in any
feature-scope UI file.
