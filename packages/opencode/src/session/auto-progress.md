# Auto-Progress Engine

## Overview

The auto-progress engine automates L1 todo transitions. It listens for `todo.updated` events and automatically advances the todo hierarchy through its lifecycle.

## How It Works

The engine uses a stateful per-session set tracked via `HashSet<string>` in a `Ref`:

1. A `Bus` subscription listens for `Todo.Updated` events
2. On each event, the `advance` function runs for the affected session
3. Advance logic:
   - If there's an L1 `in_progress` and all its L2 children are `completed` → mark L1 `completed`
   - If no L1 is `in_progress`, find the next L1 in `pending` → mark it `in_progress` and start all its pending L2 children in parallel

## Service Interface (`AutoProgress.Service`)

| Method | Input | Returns | Description |
|--------|-------|---------|-------------|
| `start` | `sessionID` | `Effect<void>` | Activate the engine for a session |
| `stop` | `sessionID` | `Effect<void>` | Deactivate the engine for a session |
| `status` | `sessionID` | `Effect<"idle" \| "running" \| "paused">` | Current engine state |
| `isActive` | `sessionID` | `Effect<boolean>` | Whether the engine is active for a session |

## State Management

The engine uses `InstanceState` (from `@/effect/instance-state`) for per-instance lifecycle. Each session gets tracked via a `HashSet` inside a `Ref`. The background stream consumer is `forkScoped` — automatically interrupted when the instance is disposed.

## Tool Access

The engine is exposed to agents via the `auto_progress` tool (defined in `src/tool/auto_progress.ts`). It accepts three actions:

- `start` — Activates the engine for the current session
- `stop` — Deactivates the engine
- `status` — Returns `"running"` or `"idle"`

## Slash Command

The TUI plugin (`src/cli/cmd/tui/command/linear.ts`) registers a `/auto-progress` slash command that toggles the engine on/off.

## Architecture

```
Todo.Updated (Bus event)
        │
        ▼
  AutoProgress.advance()
        │
        ├─ Check L1 in_progress → check children done
        │     └─ All done? → patchStatus(completed)
        │
        └─ No L1 in_progress → find next pending L1
              ├─ patchStatus(in_progress)
              └─ Start all pending L2 children (parallel)
```

## Key Behaviors

- **Idempotent**: Starting an already-running session is a no-op
- **Non-blocking**: The advance function runs synchronously on each event
- **No persistence**: The active-set is in-memory only; restarting clears it
- **Cancellation-safe**: Uses `Effect.forkScoped` so the stream consumer is cleaned up on instance disposal

## Files

- `src/session/auto-progress.ts` — Engine implementation
- `src/tool/auto_progress.ts` — Agent tool definition
- `src/tool/auto_progress.txt` — Tool prompt description
- `src/cli/cmd/tui/command/linear.ts` — Slash command registration
