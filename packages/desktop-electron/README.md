# OpenCode Desktop (Electron)

Native OpenCode desktop app, built with Electron.

## Prerequisites

- [Bun](https://bun.sh/) v1.3.11+
- Node.js v22+ (optional, Bun is preferred)

## Development

From the repo root:

```bash
bun install
bun run --cwd packages/desktop-electron dev
```

This starts the Electron app in development mode with hot reload.

## Build

### Step 1: Build the CLI

The desktop app requires the OpenCode CLI as a sidecar. Build it first:

```bash
cd packages/opencode
bun run build --single
```

### Step 2: Copy CLI to resources

```bash
mkdir -p ../desktop-electron/resources
cp dist/opencode-darwin-arm64/bin/opencode ../desktop-electron/resources/opencode-cli
```

### Step 3: Package the app

The following example is for macOS. For other platforms, see [Platform-specific Commands](#platform-specific-commands).

```bash
cd ../desktop-electron
bun run build && bun run prebuild && bun run package:mac
```

The packaged app will be in `packages/desktop-electron/dist/`.

## Platform-specific Commands

- `bun run package:mac` - Package for macOS
- `bun run package:win` - Package for Windows
- `bun run package:linux` - Package for Linux

## Architecture

The desktop app consists of:

1. **Electron main process** - Handles app lifecycle, window management, and CLI sidecar
2. **Renderer process** - SolidJS-based UI (shared with the web app)
3. **CLI sidecar** - The OpenCode CLI runs as a local server that the UI connects to
