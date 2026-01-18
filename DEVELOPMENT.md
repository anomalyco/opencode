# Development Guide

This guide covers local development workflows for opencode.

## Web UI Development

The web UI is in `packages/app` and uses SolidJS with Vite.

### Option 1: Hot Reload Development (Recommended)

Run the backend and frontend separately for hot module replacement:

**Terminal 1 - Backend server:**
```bash
bun dev serve --port 4000
```

**Terminal 2 - Vite dev server:**
```bash
VITE_OPENCODE_SERVER_HOST=localhost VITE_OPENCODE_SERVER_PORT=4000 bun run --cwd packages/app dev
```

Access the UI at `http://localhost:3000` (or whatever port Vite assigns).

For LAN access (e.g., testing from another device):
```bash
VITE_OPENCODE_SERVER_HOST=<your-lan-ip> VITE_OPENCODE_SERVER_PORT=4000 bun run --cwd packages/app dev --host
```

### Option 2: Built UI with Local Server

Build the UI once and serve it from the backend:

```bash
# Build the UI
bun run --cwd packages/app build

# Run the server with the local UI
OPENCODE_UI_PATH=packages/app/dist bun dev serve --port 4000
```

Access the UI at `http://localhost:4000`.

### Default Behavior

Without `OPENCODE_UI_PATH`, the server proxies the UI from `app.opencode.ai`. This is the production behavior and what end users experience.

## Environment Flags

See `packages/opencode/src/flag/flag.ts` for all available flags. Key development flags:

| Flag | Description |
|------|-------------|
| `OPENCODE_UI_PATH` | Path to locally built UI (enables local UI serving) |
| `OPENCODE_EXPERIMENTAL` | Enable all experimental features |
| `OPENCODE_DISABLE_AUTOUPDATE` | Disable automatic updates |

## Running Tests

```bash
# Run tests for a specific package
bun test --cwd packages/opencode

# Run tests for the app package
bun test --cwd packages/app
```

## Type Checking

```bash
# Type check all packages
bun run typecheck
```
