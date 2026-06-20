# OpenCode Todo ↔ Linear Quickstart

## Setup

### 1. Get a Linear API Key

Generate a key at [Linear Settings → API](https://linear.app/settings/api). It starts with `lina_`.

### 2. Set the environment variable

```bash
export LINEAR_API_KEY=lina_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### 3. Configure your project

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

Find the project and team IDs by running `/linear-status` in the TUI or checking your Linear workspace URL.

## Basic Workflow

### Push todos to Linear

```bash
# Push all pending todos as Linear issues
/linear-push

# Push specific todos by ID
/linear-push t1 t2 t3

# Push all (including already-pushed)
/linear-push all
```

### Pull Linear issues to todos

```bash
# Pull all active issues (unstarted/started) from your configured project
/linear-pull
```

Issues with matching `linear_issue_id` are skipped — no duplicates.

### Check sync status

```bash
/linear-status
```

Shows connection state, project/team config, sync mode, and last sync time.

### Auto-Progress

```bash
# Toggle the auto-progress engine
/auto-progress
```

The engine automatically advances L1 todos through pending → in_progress → completed as subtasks finish.

## Configuration Reference

| Setting | Default | Description |
|---------|---------|-------------|
| `linear.projectId` | — | Linear project UUID for issue mapping |
| `linear.teamId` | — | Linear team UUID for issue creation |
| `linear.syncMode` | `"manual"` | `manual`, `auto-push`, `auto-pull`, or `bidirectional` |
| `linear.autoPush` | `false` | Auto-push on todo creation |

## Priority Mapping

| Todo Priority | Linear Priority |
|--------------|-----------------|
| urgent | 1 (Urgent) |
| high | 2 (High) |
| medium | 3 (Medium) |
| low | 4 (Low) |
| none | 0 (No priority) |

## State Mapping

| Linear State | Todo Status |
|-------------|-------------|
| unstarted | pending |
| started | in_progress |
| completed | completed |
| cancelled | cancelled |

## Troubleshooting

**"LINEAR_API_KEY not set"** — Set `LINEAR_API_KEY` env var and restart.

**"Linear config missing projectId or teamId"** — Add both to `.opencode/config.json`.

**Duplicates on pull** — Check that `linear_issue_id` is saved on todos after push. Pull skips by this field.

## Architecture

```
┌──────────────┐       ┌─────────────────┐       ┌─────────────────┐
│  OpenCode     │       │  Linear MCP      │       │  Linear         │
│  Todos        │◄─────►│  Client          │◄─────►│  API            │
│  (local DB)   │       │  (StreamableHTTP)│       │  (mcp.linear.app)│
└──────────────┘       └─────────────────┘       └─────────────────┘
```

## Further Reading

- `packages/opencode/src/session/todo.md` — Todo schema & service docs
- `packages/opencode/src/session/auto-progress.md` — Auto-progress engine docs
- `packages/opencode/src/linear/README.md` — Full Linear integration guide
