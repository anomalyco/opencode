# Todo Schema & Service

## Overview

The todo system is the kernel task-management layer inside opencode. Todos are stored in a SQLite table (`TodoTable`) and accessed via the `Todo.Service` Effect service. Each todo belongs to a session and supports a two-level hierarchy (L1 sequential + L2 parallel). All mutations publish bus events so other systems (like the auto-progress engine and Linear sync) can react.

## Schema (`Todo.Info`)

Each todo item has 14 fields:

| Field             | Type                        | Description                                                            |
| ----------------- | --------------------------- | ---------------------------------------------------------------------- |
| `id`              | `string` (optional)         | Unique identifier, auto-generated via `crypto.randomUUID()` if omitted |
| `parent_id`       | `string \| null` (optional) | Parent todo ID for hierarchy; `null` = root-level                      |
| `level`           | `number` (0+)               | Hierarchy depth: `0` = root (L1), `1` = child (L2), `2` = grandchild   |
| `title`           | `string` (optional)         | Short label; falls back to `content` if not set                        |
| `content`         | `string`                    | Brief description of the task                                          |
| `description`     | `string` (default `""`)     | Detailed markdown with `@file` and `/skill` references                 |
| `status`          | `string`                    | One of: `pending`, `in_progress`, `completed`, `cancelled`, `blocked`  |
| `priority`        | `string`                    | One of: `none`, `low`, `medium`, `high`, `urgent`                      |
| `labels`          | `string[]`                  | Tags for categorization                                                |
| `due_date`        | `string \| null` (optional) | ISO 8601 date                                                          |
| `team_id`         | `string \| null` (optional) | Team ID for Linear issue sync (synced from Linear)                     |
| `project_id`      | `string \| null` (optional) | Project ID for Linear issue sync (synced from Linear)                  |
| `assignee_id`     | `string \| null` (optional) | Assignee user ID for issue sync (synced from Linear)                   |
| `linear_issue_id` | `string \| null` (optional) | Linked Linear issue ID for bidirectional sync (synced from Linear)     |

Fields marked "synced from Linear" are populated during pull operations. See [`issue/README.md`](../../issue/README.md) for sync details.

## Hierarchy Model

Todos support a two-level hierarchy:

- **L1 (root)**: `level === 0`, no `parent_id`. L1 items run sequentially. Only one L1 can be `in_progress` at a time.
- **L2 (child)**: `level === 1`, `parent_id` points to an L1 `id`. L2 items under the same parent run in parallel.

```
Session todos
├── L1: "Implement auth" (in_progress)
│   ├── L2: "Setup OAuth" (in_progress)
│   ├── L2: "Add JWT middleware" (pending)
│   └── L2: "Write tests" (pending)
├── L1: "Build dashboard" (pending)
│   └── L2: "Design layout" (pending)
└── L1: "Deploy" (pending)
```

The `getTree()` method returns L1 items with nested L2 children. Levels beyond 1 are not supported by the auto-progress engine.

## CRUD Methods

`Todo.Service` exposes 9 methods. The 7 primary CRUD methods are listed first:

| Method          | Signature                       | Returns              | Side Effects                                           |
| --------------- | ------------------------------- | -------------------- | ------------------------------------------------------ |
| `create`        | `{ sessionID, todo }`           | `Effect<Info>`       | Inserts row, publishes `Todo.Created` + `Todo.Updated` |
| `update`        | `{ sessionID, id, patch }`      | `Effect<Info>`       | Partial update, publishes `Todo.Updated`               |
| `delete`        | `{ sessionID, id }`             | `Effect<void>`       | Removes row, publishes `Todo.Deleted` + `Todo.Updated` |
| `patchStatus`   | `{ sessionID, id, status }`     | `Effect<Info>`       | Updates status only, publishes `Todo.Updated`          |
| `patchAssignee` | `{ sessionID, id, assigneeId }` | `Effect<Info>`       | Updates assignee only, publishes `Todo.Updated`        |
| `reorder`       | `{ sessionID, ids }`            | `Effect<void>`       | Sets position per id, publishes `Todo.Updated`         |
| `getTree`       | `sessionID`                     | `Effect<TodoNode[]>` | Read-only, no events                                   |
| `get`           | `sessionID`                     | `Effect<Info[]>`     | Read-only, loads all todos ordered by position         |
| `replaceAll`    | `{ sessionID, todos }`          | `Effect<void>`       | Transactional replace, publishes `Todo.Updated`        |

All mutations except `get` and `getTree` publish `Todo.Updated` with the full todo list for the session.

## Events

Four bus events are defined on `Todo.Event`:

### `Todo.Event.Created`

```ts
{
  sessionID: SessionID
  todo: Todo.Info
}
```

Emitted once by `create()` after insertion. Carries the newly created todo.

### `Todo.Event.Updated`

```ts
{ sessionID: SessionID; todos: Todo.Info[] }
```

Emitted by every mutation (`create`, `update`, `delete`, `patchStatus`, `patchAssignee`, `reorder`, `replaceAll`). Carries the full todo list after the change. The auto-progress engine subscribes to this event.

### `Todo.Event.Deleted`

```ts
{
  sessionID: SessionID
  id: string
}
```

Emitted by `delete()` before the `Updated` event. Carries only the deleted todo ID.

### `Todo.Event.Progressed`

```ts
{
  sessionID: SessionID
  from: string | null
  to: string
  reason: "auto" | "manual"
}
```

Emitted by the auto-progress engine when a todo transitions status. `from` is the previous status (null if starting from pending). `reason` is `"auto"` for engine-driven changes, `"manual"` for user-driven.

## Config Mapping

`Config.linear()` returns `{ projectId?, teamId?, syncMode, autoPush }`. These map to Todo fields during sync:

| Config Field | Todo Field   | Direction                                                          |
| ------------ | ------------ | ------------------------------------------------------------------ |
| `projectId`  | `project_id` | push/pull                                                          |
| `teamId`     | `team_id`    | push/pull                                                          |
| `syncMode`   | n/a          | Controls when sync runs (manual/auto-push/auto-pull/bidirectional) |
| `autoPush`   | n/a          | If true, push on todo creation                                     |

During `SyncPush.push()`, `teamId` and `projectId` are sent to Linear as `teamId` and `projectId` on the issue. During `SyncPull.pull()`, these fields are read back from Linear issues into `team_id` and `project_id`.

## Migration Guide

### What changed from the old schema

The old todo schema had roughly 3 fields (`id`, `content`, `status`). The new schema has 14 fields with hierarchy support.

**Old interface had:**

```ts
interface OldTodo {
  id: string
  content: string
  status: "pending" | "in_progress" | "completed"
}
```

**New interface:**

```ts
interface Todo.Info {
  id?: string
  parent_id?: string | null
  level?: number
  title?: string
  content: string
  description?: string
  status: string
  priority: string
  labels?: string[]
  due_date?: string | null
  team_id?: string | null
  project_id?: string | null
  assignee_id?: string | null
  linear_issue_id?: string | null
}
```

**Method renames:**

- Old bulk `update()` → renamed to `replaceAll()`
- New `update()` is a partial patch by id

### Before / after examples

**Old way (bulk replace):**

```ts
yield* todo.update({ sessionID, todos: [...] })
```

**New way (bulk replace):**

```ts
yield* todo.replaceAll({ sessionID, todos: [...] })
```

**New way (partial patch):**

```ts
yield * todo.update({ sessionID, id: "todo-1", patch: { status: "completed" } })
```

## Examples

### Create a todo with L2 children

```ts
import { Effect } from "effect"
import { Todo } from "@/session/todo"

const program = Effect.gen(function* () {
  const svc = yield* Todo.Service

  const parent = yield* svc.create({
    sessionID,
    todo: {
      content: "Build feature",
      status: "pending",
      priority: "high",
      level: 0,
    },
  })

  yield* svc.create({
    sessionID,
    todo: {
      content: "Write tests",
      status: "pending",
      priority: "medium",
      level: 1,
      parent_id: parent.id,
    },
  })
})
```

### Partially update a todo status

```ts
yield *
  svc.update({
    sessionID,
    id: "todo-1",
    patch: { status: "in_progress" },
  })
```

### Get hierarchical tree

```ts
const tree = yield * svc.getTree(sessionID)
for (const node of tree) {
  console.log(node.content, node.children.length)
}
```

### Reorder todos

```ts
yield * svc.reorder({ sessionID, ids: ["todo-3", "todo-1", "todo-2"] })
```

### Subscribe to todo changes

```ts
import { Bus } from "@/bus"

yield *
  bus
    .subscribe(Todo.Event.Updated)
    .pipe(Stream.runForEach((ev) => Effect.sync(() => console.log("todos updated:", ev.properties.todos.length))))
```

## Testing

Todo CRUD tests need a real database because `TodoTable` has a foreign key on `session_id`. You cannot insert todos without a valid session.

Use `AppRuntime` to bootstrap the full service stack:

```ts
import { AppRuntime } from "@/test/runtime"
import { Session } from "@/session"

const test = Effect.gen(function* () {
  const session = yield* Session.Service.create({ project_id: "test" })
  const svc = yield* Todo.Service

  const todo = yield* svc.create({
    sessionID: session.id,
    todo: { content: "Test", status: "pending", priority: "medium" },
  })

  const all = yield* svc.get(session.id)
  console.assert(all.length === 1)
})

await AppRuntime.run(test)
```

Do not mock `Database.use` directly. The FK constraint on `session_id` will reject inserts unless the session exists.

## Key Files

- `src/session/todo.ts` — Service implementation, Zod schema, DB row mapping
- `src/session/session.sql.ts` — Drizzle table definition
- `src/session/auto-progress.ts` — Auto-progress engine
- `src/tool/todo.ts` — Tool definition for the `todo` agent tool
- `src/issue/sync-push.ts` — Push todos to Linear
- `src/issue/sync-pull.ts` — Pull Linear issues into todos
