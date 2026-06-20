# OpenCode Todo ↔ Linear Quickstart

10 minutes to your first sync.

## Quickstart

### 1. Get a Linear API key

Go to [Linear Settings → API](https://linear.app/settings/api) and create a key. It starts with `lina_` and is 48 characters.

### 2. Set the environment variable

```bash
export LINEAR_API_KEY=lina_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Add this to your shell profile so it persists across restarts.

### 3. Configure project and team

Add to `.opencode/config.json`:

```json
{
  "linear": {
    "projectId": "your-project-uuid",
    "teamId": "your-team-uuid",
    "syncMode": "manual"
  }
}
```

Find the project and team IDs by running `/linear-status` in the TUI, or check your Linear workspace URL.

### 4. Create a todo

In the TUI or via agent tool:

```ts
yield* todo.create({
  sessionID,
  todo: {
    content: "Fix login bug",
    status: "pending",
    priority: "high",
  },
})
```

### 5. Push to Linear

Run `/linear-push` in the TUI. Your todo appears as a Linear issue in the configured project.

## Architecture at a Glance

OpenCode todos live in a local SQLite database. The Linear integration is a sync layer on top, triggered manually via slash commands. The auto-progress engine watches todo status changes and advances sequential L1 items automatically.

- **Kernel**: `Todo.Service` manages local todos with hierarchy (L1 sequential, L2 parallel)
- **Sync**: `SyncPush` and `SyncPull` bridge todos and Linear issues via MCP
- **Transport**: `LinearMcpClient` speaks StreamableHTTP to `mcp.linear.app`
- **Auto-progress**: Watches `Todo.Updated` events and advances L1 items when children complete

## What's New (T1–T19)

- **Hierarchy**: Todos now support L1 (sequential) and L2 (parallel) levels via `level` and `parent_id`
- **Events**: `Todo.Created`, `Todo.Updated`, `Todo.Deleted`, `Todo.Progressed` bus events
- **Linear sync**: Two-way push/pull between todos and Linear issues via MCP
- **Auto-progress**: Automatic L1 advancement as L2 children finish
- **14 fields**: `linear_issue_id`, `team_id`, `project_id`, `assignee_id`, `due_date`, `labels`, `title`, `description`, and more
- **Config-driven**: `linear.projectId`, `linear.teamId`, `linear.syncMode` in `.opencode/config.json`
- **Slash commands**: `/linear-push`, `/linear-pull`, `/linear-status`, `/auto-progress`

## Links

- [`packages/opencode/src/session/todo.md`](packages/opencode/src/session/todo.md) — Todo schema, CRUD methods, events, examples
- [`packages/opencode/src/session/auto-progress.md`](packages/opencode/src/session/auto-progress.md) — Auto-progress engine, state machine, testing
- [`packages/opencode/src/linear/README.md`](packages/opencode/src/linear/README.md) — Full Linear integration guide, MCP transport, troubleshooting
