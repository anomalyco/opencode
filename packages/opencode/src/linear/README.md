# Linear MCP Integration

## Overview

Bidirectional sync between OpenCode todos and Linear issues via the [Linear MCP server](https://mcp.linear.app/mcp). Uses the Model Context Protocol (StreamableHTTP) for all Linear API interactions — no direct Linear REST/GraphQL calls.

## Architecture

```
┌─────────────┐      ┌──────────────────┐      ┌───────────────────┐
│  OpenCode    │      │  LinearMcpClient │      │  Linear MCP       │
│  Todos       │◄────►│  (MCP Transport) │◄────►│  Server           │
│              │      │                  │      │  (mcp.linear.app) │
│  push() ─────┼─────►│  callTool()      │─────►│  save_issue       │
│  pull() ◄────┼──────│  callTool()      │◄─────│  list_issues      │
└─────────────┘      └──────────────────┘      └───────────────────┘
```

### Layers

- **Kernel Layer**: Todo service (`src/session/todo.ts`) — manages local todo state
- **Sync Layer**: SyncPush + SyncPull (`src/linear/sync-push.ts`, `src/linear/sync-pull.ts`) — bridges todos ↔ Linear issues
- **Transport Layer**: `LinearMcpClient` (`src/linear/mcp-client.ts`) — MCP protocol client over StreamableHTTP

## Configuration

Add a `linear` section to `.opencode/config.json`:

```json
{
  "linear": {
    "projectId": "your-linear-project-id",
    "teamId": "your-linear-team-id",
    "syncMode": "manual"
  }
}
```

### Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `projectId` | `string` | optional | Linear project ID for issue mapping |
| `teamId` | `string` | optional | Linear team ID for issue creation |
| `syncMode` | `"manual"` \| `"auto-push"` \| `"auto-pull"` \| `"bidirectional"` | `"manual"` | Sync strategy |
| `autoPush` | `boolean` | `false` | Whether to automatically push on todo creation |

### Authentication

The Linear MCP server authenticates via Bearer token. Set the `LINEAR_API_KEY` environment variable:

```bash
export LINEAR_API_KEY=lina_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

The client connects to `https://mcp.linear.app/mcp` by default. A custom URL can be passed to `LinearMcpClient.create({ url, key })`.

## Commands

### `/linear-push`

Push todos to Linear as issues. Supported via `SyncPush.push()`:

```
Usage: /linear-push [todoIds... | "all"]
```

- Omitting `todoIds` pushes all todos without `linear_issue_id`
- `"all"` pushes all pending todos
- Specific IDs push only those todos
- Todos that already have a `linear_issue_id` are skipped

Priority mapping:
| Todo Priority | Linear Priority |
|--------------|-----------------|
| urgent | 1 (Urgent) |
| high | 2 (High) |
| medium | 3 (Medium) |
| low | 4 (Low) |
| none | 0 (No priority) |

### `/linear-pull`

Pull Linear issues into local todos. Supported via `SyncPull.pull()`:

- Issues with state `unstarted` or `started` are pulled as pending/in_progress todos
- Issues with state `completed` or `cancelled` are skipped
- Existing todos with a matching `linear_issue_id` are skipped (dedup)
- Supports pagination through large issue lists (50 per page)
- Parent-child relationships in Linear are resolved to local `parent_id` references

State mapping:
| Linear State | Todo Status |
|-------------|-------------|
| unstarted | pending |
| started | in_progress |
| completed | completed |
| cancelled | cancelled |

### `/linear-status`

Display current Linear sync status:
- Connection state
- Configured project and team IDs
- Sync mode
- Last sync timestamp

### `/auto-progress`

Toggle the auto-progress engine for the current session. See `src/session/auto-progress.md` for details.

## Tool Names

The Linear MCP server exposes 39 tools across 8 categories (defined in `src/linear/tool-names.ts`):

| Category | Tools |
|----------|-------|
| Issue | `get_issue`, `list_issues`, `save_issue`, `list_issue_statuses`, `get_issue_status`, `list_issue_labels`, `create_issue_label` |
| Comment | `list_comments`, `save_comment`, `delete_comment` |
| User | `get_user`, `list_users` |
| Team | `get_team`, `list_teams` |
| Project | `get_project`, `list_projects`, `save_project`, `list_project_labels` |
| Cycle | `list_cycles` |
| Document | `get_document`, `list_documents`, `save_document` |
| Attachment | `get_attachment`, `create_attachment`, `prepare_attachment_upload`, `create_attachment_from_upload`, `delete_attachment` |
| Milestone | `get_milestone`, `list_milestones`, `save_milestone` |
| Diff | `get_diff`, `list_diffs`, `get_diff_threads` |
| Status Update | `get_status_updates`, `save_status_update`, `delete_status_update` |
| Image | `extract_images` |
| Docs | `search_documentation` |

## Troubleshooting

### "LINEAR_API_KEY not set"

Set the `LINEAR_API_KEY` environment variable:

```bash
export LINEAR_API_KEY=lina_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### "Failed to connect to Linear MCP"

Check:
1. The API key is valid
2. Network access to `https://mcp.linear.app/mcp` is allowed
3. The MCP server is not rate-limiting your requests

### "Linear config missing projectId or teamId"

Add `projectId` and `teamId` to the `linear` section of `.opencode/config.json`:

```json
{
  "linear": {
    "projectId": "your-project-uuid",
    "teamId": "your-team-uuid"
  }
}
```

Find these IDs by running `/linear-status` with valid credentials, or check your Linear workspace URL: `https://linear.app/<workspace>/project/<project-id>`.

### "Failed to extract Linear issue ID from response"

The MCP response format didn't match the expected GraphQL shape. Check:
1. The Linear MCP server version is compatible
2. The issue was actually created (check Linear workspace)
3. Network/proxy isn't modifying the response

## Testing

```bash
# Run unit tests (mocked MCP)
cd opencode/packages/opencode
bun test src/linear/

# Run integration tests
bun test src/linear/integration.test.ts

# Run with real MCP (requires LINEAR_API_KEY)
LINEAR_API_KEY=... bun test src/linear/integration.test.ts
```

## Key Files

| File | Purpose |
|------|---------|
| `src/linear/mcp-client.ts` | MCP client (connect, listTools, callTool, close) |
| `src/linear/sync-push.ts` | Push todos → Linear issues |
| `src/linear/sync-pull.ts` | Pull Linear issues → todos |
| `src/linear/tool-names.ts` | All 39 Linear MCP tool name constants |
| `src/linear/integration.test.ts` | Round-trip integration tests (mock) |
| `src/session/todo.ts` | Kernel todo service |
| `src/session/auto-progress.ts` | Auto-progress engine |
| `src/cli/cmd/tui/command/linear.ts` | Slash commands |
