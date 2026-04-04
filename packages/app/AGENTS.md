## Debugging

- NEVER try to restart the app, or the server process, EVER.

## Local Dev

- `opencode dev web` proxies `https://app.opencode.ai`, so local UI/CSS changes will not show there.
- For local UI changes, prefer `bun run dev:server-web` from the repo root.
- `dev:server-web` starts a local backend and local app on free ports, opens the app in the browser, and points the app at the selected backend automatically.
- To pass backend flags, use `bun run dev:server-web -- --server ...`.
- To pass app flags, use `bun run dev:server-web -- --web ...`.
- If you need fixed ports for parallel worktrees, pass `--port` to either side or use `SERVER_PORT` and `WEB_PORT`.

## SolidJS

- Always prefer `createStore` over multiple `createSignal` calls

## Tool Calling

- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.

## Browser Automation

Use `agent-browser` for web automation. Run `agent-browser --help` for all commands.

Core workflow:

1. `agent-browser open <url>` - Navigate to page
2. `agent-browser snapshot -i` - Get interactive elements with refs (@e1, @e2)
3. `agent-browser click @e1` / `fill @e2 "text"` - Interact using refs
4. Re-snapshot after page changes
