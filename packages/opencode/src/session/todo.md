# Todo Schema & Service

## Overview

The todo system is the kernel task-management layer. Todos are stored in a SQLite table (`TodoTable`) and accessed via the `Todo.Service` Effect service.

## Schema (`Todo.Info`)

Each todo item has these fields:

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` (optional) | Unique identifier, auto-generated via `crypto.randomUUID()` if omitted |
| `parent_id` | `string \| null` (optional) | Parent todo ID for hierarchy; `null` = root-level |
| `level` | `number` (0+) | Hierarchy depth: 0=root, 1=child, 2=grandchild |
| `title` | `string` (optional) | Short label; falls back to `content` if not set |
| `content` | `string` | Brief description of the task |
| `description` | `string` (default `""`) | Detailed markdown with `@file` and `/skill` references |
| `status` | `string` | One of: `pending`, `in_progress`, `completed`, `cancelled` |
| `priority` | `string` | One of: `none`, `low`, `medium`, `high`, `urgent` |
| `labels` | `string[]` | Tags for categorization |
| `due_date` | `string \| null` (optional) | ISO 8601 date |
| `team_id` | `string \| null` (optional) | Team ID for Linear issue sync |
| `project_id` | `string \| null` (optional) | Project ID for Linear issue sync |
| `assignee_id` | `string \| null` (optional) | Assignee user ID for issue sync |
| `linear_issue_id` | `string \| null` (optional) | Linked Linear issue ID for bidirectional sync |

## Hierarchy

Todos support a two-level hierarchy:

- **L1 (root)**: `level === 0`, no `parent_id`
- **L2 (child)**: `level === 1`, `parent_id` points to an L1 `id`

This is used by the auto-progress engine to automate L1→L1 transitions.

## Service Interface (`Todo.Service`)

| Method | Input | Returns | Description |
|--------|-------|---------|-------------|
| `get` | `sessionID` | `Effect<Info[]>` | Load all todos for a session, ordered by position |
| `create` | `{ sessionID, todo }` | `Effect<Info>` | Insert a todo; auto-generates id if missing |
| `update` | `{ sessionID, id, patch }` | `Effect<Info>` | Partial update by id; publishes `todo.updated` event |
| `patchStatus` | `{ sessionID, id, status }` | `Effect<Info>` | Update only the status field |
| `patchAssignee` | `{ sessionID, id, assigneeId }` | `Effect<Info>` | Update only the assignee field |
| `delete` | `{ sessionID, id }` | `Effect<void>` | Remove a todo |
| `replaceAll` | `{ sessionID, todos }` | `Effect<void>` | Replace entire todo list (transactional) |
| `reorder` | `{ sessionID, ids }` | `Effect<void>` | Set position for each id in order |
| `getTree` | `sessionID` | `Effect<TodoNode[]>` | Get hierarchical tree: L1 items with nested L2 children |

## Database Mapping

Defined in `session.sql.ts`. Columns use snake_case:

- `session_id`, `id`, `parent_id`, `level`, `title`, `content`, `description`, `status`, `priority`, `labels` (JSON string), `due_date`, `team_id`, `project_id`, `assignee_id`, `linear_issue_id`, `position`

## Events

All mutations publish a `todo.updated` bus event carrying `{ sessionID, todos }`. The auto-progress engine subscribes to these events to drive automatic L1 transitions.

## Key Files

- `src/session/todo.ts` — Service implementation, Zod schema, DB row mapping
- `src/session/session.sql.ts` — Drizzle table definition
- `src/session/auto-progress.ts` — Auto-progress engine
- `src/tool/todo.ts` — Tool definition for the `todo` agent tool
