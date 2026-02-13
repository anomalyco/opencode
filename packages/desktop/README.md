# OpenCode Desktop

Native OpenCode desktop app, built with Tauri v2.

## Development

From the repo root:

```bash
bun install
bun run --cwd packages/desktop tauri dev
```

This starts the Vite dev server on http://localhost:1420 and opens the native window.

If you only want the web dev server (no native shell):

```bash
bun run --cwd packages/desktop dev
```

## Build

To create a production `dist/` and build the native app bundle:

```bash
bun run --cwd packages/desktop tauri build
```

## Performance benchmarking

Enable perf logging (writes JSONL):

```bash
OC_PERF=1 OC_PERF_DIR="$PWD/logs/perf" bun run --cwd packages/desktop tauri dev
```

- The splash screen shows the perf file path while the server starts.
- Summarize a run:

```bash
bun run --cwd packages/desktop perf:summary /path/to/desktop-startup-*.jsonl
```

## Prerequisites

Running the desktop app requires additional Tauri dependencies (Rust toolchain, platform-specific libraries). See the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for setup instructions.
