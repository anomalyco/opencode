# MCP App Demo

A minimal demo of the MCP Apps integration in opencode.

## What it shows

- A Python MCP server with a `demo_dashboard` tool that declares `_meta.ui.resourceUri`
- An HTML app (using the standard `App` class from `@modelcontextprotocol/ext-apps`) that renders metrics, bar charts, and action buttons
- The full round-trip: tool call → `structuredContent` → iframe → button click → `_demo_action` → agent

## Setup

**1. Register the MCP server** — add to `~/.config/opencode/config.json` (global) or `./opencode.json` (project):

```json
{
  "mcp": {
    "demo": {
      "type": "local",
      "command": ["python3", "/path/to/opencode/packages/opencode/test/fixture/mcp-app-demo/server.py"]
    }
  }
}
```

**2. Start the dev backend + app:**

```sh
# terminal 1 — backend
cd packages/opencode
bun run --conditions=browser ./src/index.ts serve --port 4096

# terminal 2 — frontend
cd packages/app
bun dev -- --port 4444
```

**3. Open `http://localhost:4444`** and ask the agent to call the tool:

> "Use demo_dashboard to show me a dashboard"

You should see the iframe render inside the tool result with live metrics, bar charts, and buttons.

## Files

| File        | Purpose                                                                           |
| ----------- | --------------------------------------------------------------------------------- |
| `server.py` | MCP server — registers tools with `_meta.ui`, returns `structuredContent`         |
| `app.html`  | Self-contained HTML app — receives tool result via `App` class postMessage bridge |
