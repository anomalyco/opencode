# Linear MCP Integration

## Overview

Bidirectional sync between OpenCode todos and Linear issues via the [Linear MCP server](https://mcp.linear.app/mcp). Uses the Model Context Protocol (StreamableHTTP) for all Linear API interactions. No direct Linear REST or GraphQL calls are made from opencode code.

The sync model is git-push style: you create todos locally, then push them to Linear. You can also pull active Linear issues back into local todos. Conflicts are resolved by deduplication on `linear_issue_id`.

## Setup

1. **Get a Linear API key** from [Linear Settings → API](https://linear.app/settings/api). It starts with `lina_` and is 48 characters.

2. **Set the environment variable:**

   ```bash
   export LINEAR_API_KEY=lina_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```

3. **Configure project and team IDs** via `.opencode/config.json` or the `dialog-linear-config` UI:

   ```json
   {
     "linear": {
       "projectId": "your-linear-project-id",
       "teamId": "your-linear-team-id",
       "syncMode": "manual"
     }
   }
   ```

   Find project and team IDs by running `/linear-status` with valid credentials, or check your Linear workspace URL: `https://linear.app/<workspace>/project/<project-id>`.

## MCP Transport

The `LinearMcpClient` uses `StreamableHTTPClientTransport` to connect to `https://mcp.linear.app/mcp`. Authentication is via an `Authorization: Bearer ${LINEAR_API_KEY}` header.

```ts
const client =
  yield *
  LinearMcpClient.create({
    url: "https://mcp.linear.app/mcp",
    key: process.env.LINEAR_API_KEY,
  })
```

Note: `mcp-remote` was unavailable during development, so the integration uses direct transport. The client connects on `create()`, fails on disconnect, and cleans up on `close()`.

## Tool Naming

**CRITICAL**: Linear MCP tools are NOT prefixed with `linear_`. Use the exact names from `src/issue/tool-names.ts`:

| Tool          | Name            |
| ------------- | --------------- |
| Save issue    | `save_issue`    |
| List issues   | `list_issues`   |
| Get issue     | `get_issue`     |
| Save comment  | `save_comment`  |
| List comments | `list_comments` |

For the full list, import `ISSUE`, `COMMENT`, `USER`, `TEAM`, `PROJECT`, etc. from `src/issue/tool-names.ts`.

## Tool Categories

The Linear MCP server exposes tools across 12 categories:

| Category        | Count | Key Tools                                                          |
| --------------- | ----- | ------------------------------------------------------------------ |
| `ISSUE`         | 7     | `get_issue`, `list_issues`, `save_issue`, `list_issue_statuses`    |
| `COMMENT`       | 3     | `list_comments`, `save_comment`, `delete_comment`                  |
| `USER`          | 2     | `get_user`, `list_users`                                           |
| `TEAM`          | 2     | `get_team`, `list_teams`                                           |
| `PROJECT`       | 4     | `get_project`, `list_projects`, `save_project`                     |
| `CYCLE`         | 1     | `list_cycles`                                                      |
| `DOCUMENT`      | 3     | `get_document`, `list_documents`, `save_document`                  |
| `ATTACHMENT`    | 5     | `get_attachment`, `create_attachment`, `prepare_attachment_upload` |
| `MILESTONE`     | 3     | `get_milestone`, `list_milestones`, `save_milestone`               |
| `DIFF`          | 3     | `get_diff`, `list_diffs`, `get_diff_threads`                       |
| `STATUS_UPDATE` | 3     | `get_status_updates`, `save_status_update`, `delete_status_update` |
| `IMAGE`         | 1     | `extract_images`                                                   |

Total: 39 tools. See `src/issue/tool-names.ts` for the complete flat record.

## Linear Schema

### Input shape

Linear MCP tools follow GraphQL conventions. The input is wrapped in an `input` object:

```ts
{
  input: {
    title: string
    description: string
    teamId: string
    projectId: string
    priority: number
    assigneeId?: string
  }
}
```

### Response shape

The MCP response contains JSON-encoded GraphQL data inside `content[].text`:

```ts
{
  content: [
    {
      type: "text",
      text: '{"data":{"saveIssue":{"id":"abc-123",...}}}',
    },
  ]
}
```

Both `SyncPush` and `SyncPull` use defensive parsing to extract fields from this nested structure. Do not assume a flat response.

## Priority Mapping

| Todo Priority | Linear Priority   |
| ------------- | ----------------- |
| `urgent`      | `1` (Urgent)      |
| `high`        | `2` (High)        |
| `medium`      | `3` (Medium)      |
| `low`         | `4` (Low)         |
| `none`        | `0` (No priority) |

Linear uses `0` for no priority and `1` for urgent. This is the reverse of typical numeric priority ordering.

## Sync Engines

### Push (`SyncPush.push()`)

Converts local todos to Linear issues via `ISSUE.SAVE`:

- Skips todos that already have a `linear_issue_id`
- Processes todos concurrently (up to `DEFAULT_BATCH = 10`)
- On success, updates the todo with the new `linear_issue_id`
- On per-todo failure, collects the error and continues

### Pull (`SyncPull.pull()`)

Converts Linear issues to local todos via `ISSUE.LIST`:

- Fetches all issues for the configured project (paginated, 50 per page)
- Filters to active states only: `unstarted` and `started`
- Skips issues whose `linear_issue_id` already exists locally (dedup)
- Resolves parent-child relationships from Linear to local `parent_id`
- Creates todos in batch with configurable concurrency

## Commands

Four slash commands are registered in the TUI:

### `/auto-progress`

Toggles the auto-progress engine for the current session. See `src/session/auto-progress.md` for details.

### `/linear-push`

Push todos to Linear as issues.

```
Usage: /linear-push [todoIds... | "all"]
```

- Omitting `todoIds` pushes all todos without `linear_issue_id`
- `"all"` pushes all todos
- Specific IDs push only those todos
- Todos that already have a `linear_issue_id` are skipped

### `/linear-pull`

Pull Linear issues into local todos.

- Issues with state `unstarted` or `started` are pulled
- Issues with state `completed` or `cancelled` are skipped
- Existing todos with a matching `linear_issue_id` are skipped (dedup)
- Supports pagination through large issue lists

### `/linear-status`

Display current Linear sync status:

- Connection state
- Configured project and team IDs
- Sync mode
- Last sync timestamp

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    OpenCode Kernel                           │
│  ┌─────────────┐      ┌─────────────────┐                  │
│  │ Todo.Service│◄────►│ AutoProgress    │                  │
│  │ (SQLite)    │      │ (Bus consumer)  │                  │
│  └──────┬──────┘      └─────────────────┘                  │
│         │                                                    │
│         │ push()                    pull()                   │
│         ▼                        ▲                          │
│  ┌──────────────┐         ┌──────────────┐                  │
│  │  SyncPush    │         │  SyncPull    │                  │
│  │  mapTodoTo   │         │  mapIssueTo  │                  │
│  │  Issue       │         │  Todo        │                  │
│  └──────┬───────┘         └──────┬───────┘                  │
│         │                        │                           │
│         │    callTool()          │   callTool()              │
│         ▼                        ▼                           │
│  ┌─────────────────────────────────────┐                    │
│  │     LinearMcpClient                 │                    │
│  │     StreamableHTTPClientTransport   │                    │
│  │     https://mcp.linear.app/mcp      │                    │
│  └─────────────────────────────────────┘                    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌───────────────────┐
                    │  Linear MCP Server │
                    │  (GraphQL API)     │
                    └───────────────────┘
```

The kernel layer (`Todo.Service`, `AutoProgress`) is standalone. The sync layer (`SyncPush`, `SyncPull`, `LinearMcpClient`) is user-triggered via slash commands.

## Troubleshooting

### "LINEAR_API_KEY not set"

Set the `LINEAR_API_KEY` environment variable and restart opencode:

```bash
export LINEAR_API_KEY=lina_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### "Failed to connect to Linear MCP"

Check:

1. The API key is valid and has not expired
2. Network access to `https://mcp.linear.app/mcp` is allowed
3. The MCP server is not rate-limiting your requests

### "Linear config missing projectId or teamId"

Add both fields to the `linear` section of `.opencode/config.json`:

```json
{
  "linear": {
    "projectId": "your-project-uuid",
    "teamId": "your-team-uuid"
  }
}
```

### "Failed to extract Linear issue ID from response"

The MCP response format did not match the expected GraphQL shape. Check:

1. The Linear MCP server version is compatible
2. The issue was actually created (check Linear workspace)
3. Network or proxy is not modifying the response

### Sync conflicts / duplicates on pull

Pull skips by `linear_issue_id`. After a successful push, the todo is updated with the Linear issue ID. If you see duplicates, check that the push succeeded and the ID was saved. The `extractId()` parser in `sync-push.ts` handles multiple response shapes, but new MCP versions may change the format.

## Testing

```bash
cd opencode/packages/opencode

# Run unit tests (mocked MCP)
bun test src/issue/

# Run integration tests
bun test src/issue/sync-pull.test.ts

# Run with real MCP (requires LINEAR_API_KEY)
LINEAR_API_KEY=... bun test src/issue/sync-pull.test.ts
```

## Key Files

| File                                | Purpose                                          |
| ----------------------------------- | ------------------------------------------------ |
| `src/issue/mcp-client.ts`          | MCP client (connect, listTools, callTool, close) |
| `src/issue/sync-push.ts`           | Push todos to Linear issues                      |
| `src/issue/sync-pull.ts`           | Pull Linear issues into todos                    |
| `src/issue/tool-names.ts`          | All 39 Linear MCP tool name constants            |
| `src/issue/mcp-client.test.ts`     | Round-trip integration tests                     |
| `src/issue/issue.ts`               | Kernel issue service                             |
| `src/session/auto-progress.ts`      | Auto-progress engine                             |
| `src/cli/cmd/tui/command/linear.ts` | Slash commands                                   |

## References

- [`OPENCODE_TODO_LINEAR_GUIDE.md`](../../../../../OPENCODE_TODO_LINEAR_GUIDE.md) — Top-level quickstart (10 min to first sync)
- [`src/session/todo.md`](../session/todo.md) — Todo schema and service docs
- [`src/session/auto-progress.md`](../session/auto-progress.md) — Auto-progress engine docs
