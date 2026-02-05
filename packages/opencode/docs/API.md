# OpenCode API Reference

## Overview

OpenCode provides a REST API and WebSocket connections when running in server mode:

```bash
opencode serve --port 8080
```

Base URL: `http://localhost:8080`

An OpenAPI specification is available at `GET /doc`.

## Authentication

If `OPENCODE_SERVER_PASSWORD` is set, all endpoints require HTTP Basic Auth:
- Username: `OPENCODE_SERVER_USERNAME` (default: `opencode`)
- Password: `OPENCODE_SERVER_PASSWORD`

## Rate Limiting

All endpoints are rate-limited to **200 requests per minute** per IP.

Response headers on every request:

| Header | Description |
|--------|-------------|
| `X-RateLimit-Limit` | Maximum requests per window |
| `X-RateLimit-Remaining` | Remaining requests in current window |
| `X-RateLimit-Reset` | Window reset time (Unix timestamp, seconds) |

Exceeding the limit returns `429 Too Many Requests`.

## Security Headers

All responses include:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 0`
- `Cache-Control: no-store`

Request body size limit: **10 MB**.

## Directory Context

Most endpoints (except `/global/*`, `/auth/*`, `/log`, `/doc`) are scoped to a project directory.
Specify it via:
- Query parameter: `?directory=/path/to/project`
- Header: `X-OpenCode-Directory`
- Falls back to the server's working directory (`process.cwd()`)

---

## REST Endpoints

### Global (prefix: `/global`)

These endpoints do **not** require a project directory context.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/global/health` | Health check. Returns `{ healthy: true, version }` |
| GET | `/global/event` | Subscribe to global SSE event stream |
| GET | `/global/config` | Get global configuration |
| PATCH | `/global/config` | Update global configuration |
| POST | `/global/dispose` | Dispose all OpenCode instances |

### Authentication (prefix: `/auth`)

| Method | Path | Description |
|--------|------|-------------|
| PUT | `/auth/:providerID` | Set auth credentials for a provider |
| DELETE | `/auth/:providerID` | Remove auth credentials for a provider |

### Sessions (prefix: `/session`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/session` | List all sessions (supports `?directory`, `?roots`, `?start`, `?search`, `?limit`) |
| POST | `/session` | Create new session |
| GET | `/session/status` | Get status of all sessions |
| GET | `/session/:sessionID` | Get session details |
| PATCH | `/session/:sessionID` | Update session (title, archive time) |
| DELETE | `/session/:sessionID` | Delete session |
| GET | `/session/:sessionID/children` | List child sessions forked from this session |
| GET | `/session/:sessionID/todo` | Get session todo list |
| GET | `/session/:sessionID/diff` | Get file changes diff for a message (`?messageID=`) |
| POST | `/session/:sessionID/init` | Initialize session (create AGENTS.md) |
| POST | `/session/:sessionID/fork` | Fork session at a specific message point |
| POST | `/session/:sessionID/abort` | Abort active session processing |
| POST | `/session/:sessionID/share` | Create shareable link |
| DELETE | `/session/:sessionID/share` | Remove shareable link |
| POST | `/session/:sessionID/summarize` | Summarize session via AI compaction |
| POST | `/session/:sessionID/revert` | Revert a message, undoing its effects |
| POST | `/session/:sessionID/unrevert` | Restore all previously reverted messages |

#### Session Messages

| Method | Path | Description |
|--------|------|-------------|
| GET | `/session/:sessionID/message` | List messages in a session (`?limit=`) |
| POST | `/session/:sessionID/message` | Send message (streams AI response) |
| GET | `/session/:sessionID/message/:messageID` | Get a specific message |
| DELETE | `/session/:sessionID/message/:messageID/part/:partID` | Delete a part from a message |
| PATCH | `/session/:sessionID/message/:messageID/part/:partID` | Update a part in a message |

#### Session Commands

| Method | Path | Description |
|--------|------|-------------|
| POST | `/session/:sessionID/prompt_async` | Send async message (returns immediately) |
| POST | `/session/:sessionID/command` | Execute a command in session |
| POST | `/session/:sessionID/shell` | Run shell command in session context |

#### Session Permissions (deprecated)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/session/:sessionID/permissions/:permissionID` | Respond to permission request (deprecated, use `/permission`) |

### PTY / Terminal (prefix: `/pty`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/pty` | List all PTY sessions |
| POST | `/pty` | Create new PTY session |
| GET | `/pty/:ptyID` | Get PTY session details |
| PUT | `/pty/:ptyID` | Update PTY session |
| DELETE | `/pty/:ptyID` | Remove and terminate PTY session |
| POST | `/pty/:ptyID/token` | Generate one-time WebSocket auth token |
| WS | `/pty/:ptyID/connect?token=<token>` | WebSocket terminal connection |

### Configuration (prefix: `/config`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/config` | Get current project configuration |
| PATCH | `/config` | Update project configuration |
| GET | `/config/providers` | List configured providers with default models |

### MCP (prefix: `/mcp`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/mcp` | Get status of all MCP servers |
| POST | `/mcp` | Add a new MCP server (body: `{ name, config }`) |
| POST | `/mcp/:name/auth` | Start OAuth flow for an MCP server |
| POST | `/mcp/:name/auth/callback` | Complete OAuth with authorization code |
| POST | `/mcp/:name/auth/authenticate` | Start OAuth and wait for callback (opens browser) |
| DELETE | `/mcp/:name/auth` | Remove OAuth credentials |
| POST | `/mcp/:name/connect` | Connect an MCP server |
| POST | `/mcp/:name/disconnect` | Disconnect an MCP server |

### Provider (prefix: `/provider`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/provider` | List all available providers with connected status |
| GET | `/provider/auth` | Get authentication methods for all providers |
| POST | `/provider/:providerID/oauth/authorize` | Initiate OAuth authorization |
| POST | `/provider/:providerID/oauth/callback` | Handle OAuth callback |

### Permission (prefix: `/permission`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/permission` | List all pending permission requests |
| POST | `/permission/:requestID/reply` | Approve or deny a permission request |

### Question (prefix: `/question`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/question` | List all pending questions |
| POST | `/question/:requestID/reply` | Reply to a question request |
| POST | `/question/:requestID/reject` | Reject a question request |

### Project (prefix: `/project`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/project` | List all projects |
| GET | `/project/current` | Get current project |
| PATCH | `/project/:projectID` | Update project properties |

### File & Search

| Method | Path | Description |
|--------|------|-------------|
| GET | `/find` | Search text in files with ripgrep (`?pattern=`) |
| GET | `/find/file` | Search files by name (`?query=`, `?dirs=`, `?type=`, `?limit=`) |
| GET | `/find/symbol` | Search workspace symbols via LSP (`?query=`) |
| GET | `/file` | List files in a directory (`?path=`) |
| GET | `/file/content` | Read file content (`?path=`) |
| GET | `/file/status` | Get git status of all files |

### Experimental (prefix: `/experimental`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/experimental/tool/ids` | List all available tool IDs |
| GET | `/experimental/tool` | List tools with JSON schemas (`?provider=`, `?model=`) |
| POST | `/experimental/worktree` | Create a git worktree |
| GET | `/experimental/worktree` | List worktrees |
| DELETE | `/experimental/worktree` | Remove a worktree |
| POST | `/experimental/worktree/reset` | Reset worktree to default branch |
| GET | `/experimental/resource` | Get available MCP resources |

### TUI Control (prefix: `/tui`)

Endpoints for controlling the Terminal User Interface programmatically.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/tui/append-prompt` | Append text to the TUI prompt |
| POST | `/tui/submit-prompt` | Submit the current prompt |
| POST | `/tui/clear-prompt` | Clear the prompt |
| POST | `/tui/open-help` | Open the help dialog |
| POST | `/tui/open-sessions` | Open the sessions dialog |
| POST | `/tui/open-themes` | Open the themes dialog |
| POST | `/tui/open-models` | Open the models dialog |
| POST | `/tui/execute-command` | Execute a TUI command (body: `{ command }`) |
| POST | `/tui/show-toast` | Show a toast notification |
| POST | `/tui/publish` | Publish a TUI event |
| POST | `/tui/select-session` | Select and navigate to a session |
| GET | `/tui/control/next` | Get next TUI request from queue |
| POST | `/tui/control/response` | Submit response to TUI request queue |

### Miscellaneous (top-level)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/doc` | OpenAPI specification (JSON) |
| GET | `/path` | Get instance paths (home, state, config, worktree, directory) |
| GET | `/vcs` | Get VCS info (current git branch) |
| GET | `/command` | List all available commands |
| POST | `/log` | Write a log entry (body: `{ service, level, message, extra? }`) |
| GET | `/agent` | List all available AI agents |
| GET | `/skill` | List all available skills |
| GET | `/lsp` | Get LSP server status |
| GET | `/formatter` | Get formatter status |
| GET | `/event` | Subscribe to instance SSE event stream |
| POST | `/instance/dispose` | Dispose current instance and release resources |

---

## WebSocket Connections

### PTY Terminal Connection

**Endpoint**: `ws://localhost:8080/pty/:ptyID/connect?token=<token>`

1. Create a PTY session via `POST /pty`
2. Generate a one-time token via `POST /pty/:ptyID/token`
3. Connect via WebSocket with the token as a query parameter

**Message format**: Raw terminal data (text). Maximum WebSocket message size: 64 KB.

**Events**:
- `onOpen` - Terminal connection established
- `onMessage` - Terminal output data
- `onClose` - Terminal connection closed

---

## Server-Sent Events (SSE)

### Instance Events

**Endpoint**: `GET /event`

Streams all bus events for the current project directory instance.

**Initial event**:
```json
{ "type": "server.connected", "properties": {} }
```

**Heartbeat** (every 30s):
```json
{ "type": "server.heartbeat", "properties": {} }
```

**Event format**:
```json
{
  "type": "<event.type>",
  "properties": { ... }
}
```

The stream closes when an `instance.disposed` event is received.

### Global Events

**Endpoint**: `GET /global/event`

Streams events from all project instances.

**Event format**:
```json
{
  "directory": "<project-directory>",
  "payload": {
    "type": "<event.type>",
    "properties": { ... }
  }
}
```

**Initial event**:
```json
{ "payload": { "type": "server.connected", "properties": {} } }
```

**Heartbeat** (every 30s):
```json
{ "payload": { "type": "server.heartbeat", "properties": {} } }
```

---

## Error Handling

All errors return a JSON object with the following structure:

```json
{
  "name": "ErrorName",
  "message": "Human-readable error description"
}
```

**Status codes**:
- `400` - Bad request / validation error
- `404` - Resource not found
- `413` - Request body too large (> 10 MB)
- `429` - Rate limit exceeded
- `500` - Internal server error

---

## CORS Policy

The server allows CORS requests from:
- `http://localhost:*`
- `http://127.0.0.1:*`
- `tauri://localhost` and `http://tauri.localhost`
- `https://*.opencode.ai`
- Any origins added to the CORS whitelist via server options

All other origins are rejected.
