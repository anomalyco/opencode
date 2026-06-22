# Voxcode

**OpenCode with voice** — one local command that starts opencode and the voice sidecar.

## Requirements

- [OpenCode](https://opencode.ai) (or run from this repo — voxcode finds `packages/opencode` in dev)
- Python 3.9+ with `pip`
- `XAI_API_KEY` from [console.x.ai](https://console.x.ai)

## Quick start (dev)

```sh
export XAI_API_KEY="xai-…"

# from repo root
bun run --cwd packages/voxcode dev web
bun run --cwd packages/voxcode dev
bun run --cwd packages/voxcode dev tui ./my-project
```

Or link the bin:

```sh
export PATH="$PWD/packages/voxcode/bin:$PATH"
voxcode web
```

## Build a self-contained install

```sh
bun run --cwd packages/voxcode build --single
# → packages/voxcode/dist/voxcode-darwin-arm64/
#     bin/voxcode
#     bin/opencode
#     voice-sidecar/
```

Add the `bin` directory to your PATH:

```sh
export PATH="$PWD/packages/voxcode/dist/voxcode-darwin-arm64/bin:$PATH"
voxcode web
```

The build bundles **voxcode**, **opencode**, and the **voice sidecar** Python package. On first voice run, voxcode runs `pip install -e` for the sidecar if needed. You still need Python 3.9+ on your machine.

Fast rebuild without recompiling opencode:

```sh
bun run --cwd packages/voxcode build --single --skip-opencode
```

## Commands

| Command | What it does |
|---|---|
| `voxcode` | Terminal UI + voice |
| `voxcode tui [dir]` | Same |
| `voxcode web` | Web UI in browser + voice |
| `voxcode run …` | Pass-through to opencode (no voice) |

## Environment

| Variable | Purpose |
|---|---|
| `XAI_API_KEY` | Required for voice |
| `VOXCODE_VOICE_PORT` | Sidecar port (default `8765`) |
| `VOXCODE_OPENCODE_BIN` | Path to opencode binary or `index.ts` |
| `VOXCODE_SIDECAR_ROOT` | Path to voice-sidecar package |
| `VOXCODE_PYTHON` | Python executable (default `python3`) |
