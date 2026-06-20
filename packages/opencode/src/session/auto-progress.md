# Auto-Progress Engine

## Overview

The auto-progress engine automates L1 todo transitions. It listens for `Todo.Updated` events and automatically advances the todo hierarchy through its lifecycle. When an L1 item is `in_progress` and all its L2 children reach `completed`, the engine marks the L1 as `completed` and starts the next pending L1. This removes manual status updates during sequential work.

## L1/L2 Model

The engine operates on a two-level hierarchy:

- **L1 (level 0)**: Sequential. Only one L1 can be `in_progress` at a time.
- **L2 (level 1)**: Parallel. All L2 children under the active L1 start together.

```
L1 sequential pipeline:

  [L1: "Setup"]        [L1: "Build"]        [L1: "Deploy"]
      │                     │                     │
      ▼                     ▼                     ▼
  ┌─────────┐          ┌─────────┐          ┌─────────┐
  │ L2: A   │          │ L2: D   │          │ L2: G   │
  │ L2: B   │          │ L2: E   │          │ L2: H   │
  │ L2: C   │          │ L2: F   │          │         │
  └─────────┘          └─────────┘          └─────────┘

  All L2s run in parallel within their L1 parent.
  When all L2s complete, the L1 completes and the next L1 starts.
```

## State Machine

The engine tracks each session in one of two states:

```
     ┌─────────┐
     │  idle   │◄─────────────────────────────┐
     └────┬────┘                              │
          │ start()                            │ stop()
          ▼                                    │
     ┌─────────┐     pause()     ┌────────┐   │
     │ running │────────────────►│ paused │───┘
     └────┬────┘                 └────────┘ resume()
          │
          │ error during advance
          ▼
     ┌─────────┐
     │  error  │─────► logs error, stays idle for session
     └─────────┘
```

- **idle**: Session not tracked. No automatic advancement.
- **running**: Session is in the active set. `advance()` runs on every `Todo.Updated`.
- **paused**: Not implemented in current version (reserved for future UI control).

Transitions are triggered by `start()`, `stop()`, and internal `advance()` logic.

## Events Consumed/Emitted

### Consumed

| Event | Source | Handler |
|-------|--------|---------|
| `Todo.Event.Updated` | `Bus` | Triggers `advance()` for the affected session |

### Emitted

| Event | Payload | When |
|-------|---------|------|
| `Todo.Event.Progressed` | `{ sessionID, from, to, reason: "auto" }` | When the engine changes a todo status |

The engine never emits `Todo.Event.Updated` directly. It calls `todo.patchStatus()` which publishes `Updated` internally.

## Service API

`AutoProgress.Service` is an Effect context service with 4 methods:

| Method | Signature | Returns | Description |
|--------|-----------|---------|-------------|
| `start` | `sessionID` | `Effect<void>` | Activate the engine for a session. Idempotent. |
| `stop` | `sessionID` | `Effect<void>` | Deactivate the engine for a session. |
| `status` | `sessionID` | `Effect<"idle" \| "running">` | Current engine state for the session. |
| `isActive` | `sessionID` | `Effect<boolean>` | Whether the session is in the active set. |

## Effect.forkScoped Pattern

The engine uses `Effect.forkScoped` to run a background stream consumer:

```ts
yield* bus.subscribe(Todo.Event.Updated).pipe(
  Stream.tap((ev) =>
    Effect.gen(function* () {
      const sid = ev.properties.sessionID
      const set = yield* Ref.get(ref)
      if (!HashSet.has(set, sid)) return
      yield* advance(todo, bus, sid as SessionID)
    }),
  ),
  Stream.runDrain,
  Effect.forkScoped,
)
```

This pattern means:

1. The stream runs in a fiber scoped to the `InstanceState` lifetime
2. When the instance is disposed, the fiber is automatically interrupted
3. No manual cleanup is required

## Examples

### Scenario 1: L1 all done, next starts

```
Initial:
  L1 "A" (in_progress)
    L2 "A1" (completed)
    L2 "A2" (completed)
  L1 "B" (pending)
    L2 "B1" (pending)

Event: Todo.Updated (A2 completed)
Engine: A children all done -> patchStatus(A, completed)
Engine: Next pending L1 is B -> patchStatus(B, in_progress)
Engine: Start B1 -> patchStatus(B1, in_progress)
```

### Scenario 2: L2 partially done, engine waits

```
Initial:
  L1 "A" (in_progress)
    L2 "A1" (completed)
    L2 "A2" (in_progress)

Event: Todo.Updated (A1 completed)
Engine: A2 is still in_progress -> do nothing, wait
```

### Scenario 3: No L2 children, L1 advances immediately

```
Initial:
  L1 "A" (in_progress)
  L1 "B" (pending)

Event: Todo.Updated (any change)
Engine: A has no children -> patchStatus(A, completed)
Engine: Start B -> patchStatus(B, in_progress)
```

### Scenario 4: Blocked todo, engine skips

```
Initial:
  L1 "A" (in_progress)
    L2 "A1" (blocked)

Event: Todo.Updated
Engine: A1 is blocked (not completed) -> do nothing
Note: "blocked" is not a terminal state. The engine only checks for "completed".
```

### Programmatic usage

```ts
import { Effect } from "effect"
import { AutoProgress } from "@/session/auto-progress"

const program = Effect.gen(function* () {
  const ap = yield* AutoProgress.Service

  yield* ap.start(sessionID)
  const state = yield* ap.status(sessionID)
  console.log(state) // "running"

  yield* ap.stop(sessionID)
})
```

## TUI Integration

The TUI plugin (`src/cli/cmd/tui/command/linear.ts`) registers an `/auto-progress` slash command that toggles the engine on/off for the current session. The command stores state in a KV store and shows a toast notification.

The `auto_progress` tool (`src/tool/auto_progress.ts`) also exposes the engine to agents via three actions: `start`, `stop`, `status`.

## Testing

Test state transitions with a mock `Bus` and `Todo.Service`:

```ts
import { Effect, PubSub, Stream } from "effect"
import { Bus } from "@/bus"
import { Todo } from "@/session/todo"
import { AutoProgress } from "@/session/auto-progress"

const test = Effect.gen(function* () {
  // Setup mock bus and todo service
  const bus = yield* Bus.Service
  const todo = yield* Todo.Service

  const ap = yield* AutoProgress.Service

  // Start engine
  yield* ap.start(sessionID)

  // Create L1 with two L2 children
  const l1 = yield* todo.create({ sessionID, todo: { content: "L1", status: "in_progress", priority: "medium", level: 0 } })
  yield* todo.create({ sessionID, todo: { content: "L2a", status: "in_progress", priority: "medium", level: 1, parent_id: l1.id } })
  const l2b = yield* todo.create({ sessionID, todo: { content: "L2b", status: "pending", priority: "medium", level: 1, parent_id: l1.id } })

  // Complete L2a
  yield* todo.patchStatus({ sessionID, id: l2b.id!, status: "completed" })

  // Engine should now mark L1 completed
  const all = yield* todo.get(sessionID)
  const parent = all.find((t) => t.id === l1.id)
  console.assert(parent?.status === "completed")
})
```

For real integration tests, use `AppRuntime` with a real database, because `Todo.Service` depends on `Database` and `Bus` layers.

## Key Files

- `src/session/auto-progress.ts` — Engine implementation
- `src/tool/auto_progress.ts` — Agent tool definition
- `src/tool/auto_progress.txt` — Tool prompt description
- `src/cli/cmd/tui/command/linear.ts` — Slash command registration
- `src/session/todo.md` — Todo schema docs
