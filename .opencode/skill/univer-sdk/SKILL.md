---
name: univer-sdk
description: Control the live Univer spreadsheet from Python via the Veritly WebSocket relay. Load when reading or editing cells, charts, or running Univer facade commands against the open sheet in the browser.
---

# Veritly Univer Python SDK

The SDK talks to a **local Bun relay** (`packages/univer-sdk/script/sdk-relay.ts`) that bridges **agent** WebSocket clients to the **browser** tab running Univer. The app must set `VITE_UNIVER_SDK_WS` so the viewer connects as `role=browser`; agents use `role=agent` (added automatically by the SDK).

## Prerequisites

1. **Relay running** on the same machine as OpenCode (e.g. `bun run sdk-relay` from `packages/univer-sdk`, or your process manager). Default listen: `ws://127.0.0.1:18766/ws` (port from `UNIVER_SDK_PORT`, default `18766`).
2. **Browser session** with a spreadsheet open and connected to the relay (otherwise agent requests have no peer).
3. **Python** with `websockets` (declared in `packages/univer-sdk/python/pyproject.toml`).

### Python import: hosted vs local

- **Railway / hosted OpenCode:** The Docker image runs `pip install` on `packages/univer-sdk/python` at build time. `python3` can `import veritly_univer_sdk` with no extra steps.
- **Local dev:** From the submodule, run the install script once (editable install from the correct folder):

```bash
bash /ABS/PATH/TO/veritly/vendor/opencode-veritly/packages/univer-sdk/python/install-local.sh
```

If your cwd is the Veritly repo root:

```bash
bash vendor/opencode-veritly/packages/univer-sdk/python/install-local.sh
```

The module file is `packages/univer-sdk/python/veritly_univer_sdk.py` (path relative to the `vendor/opencode-veritly` checkout).

## Default URL and environment

| Variable | Purpose |
|----------|---------|
| `UNIVER_SDK_WS` | Full WebSocket URL (e.g. `ws://127.0.0.1:18766/ws`). Overrides host/port defaults. |
| `UNIVER_SDK_PORT` | Used only when `UNIVER_SDK_WS` is unset: builds `ws://127.0.0.1:{port}/ws` (default port `18766`). |

`UniverSDK()` with no arguments uses the above. Pass an explicit URL only when needed:

```python
UniverSDK("ws://127.0.0.1:18766/ws")
```

## Quick start

```python
import asyncio
from veritly_univer_sdk import RangeRect, UniverSDK

async def main() -> None:
    sdk = UniverSDK()
    await sdk.connect()
    try:
        doc = await sdk.get_active_document()
        rows = await sdk.get_range(
            RangeRect(startRow=0, endRow=10, startColumn=0, endColumn=2),
            sheet_id=doc.sheetId,
        )
        print(rows)
        await sdk.set_range(
            RangeRect(startRow=0, endRow=0, startColumn=0, endColumn=1),
            [["Hello"]],
            sheet_id=doc.sheetId,
        )
    finally:
        await sdk.close()

asyncio.run(main())
```

## Operations (relay `op` names)

| Python method | `op` | Notes |
|---------------|------|--------|
| `get_active_document()` | `get_active_document` | `unitId`, `sheetId`, `sheetName` |
| `list_sheets()` | `list_sheets` | |
| `get_range(...)` | `get_range` | Inclusive row/column indices |
| `set_range(...)` | `set_range` | 2D values matrix |
| `add_chart(...)` | `add_chart` | Optional `chart_type`, `anchor` |
| `inspect_facade(...)` | `sdk_introspect` | Lists facade method names |
| `execute_command(id, params)` | `execute_command` | Raw `univerAPI.executeCommand` |

Full JSON shapes: `packages/univer-sdk/python/INTERFACE.md`.

## Charts and advanced mutations

`add_chart` uses Univer’s insert-chart path. For drawing-level commands, use `execute_command` with the command id and params your app supports (see browser / Univer docs).

## Troubleshooting

- **`UniverSDK is not connected`** — call `await sdk.connect()` before other methods.
- **Relay errors / timeout** — ensure relay is up, port matches `UNIVER_SDK_WS` / `UNIVER_SDK_PORT`, and the spreadsheet tab is open with `VITE_UNIVER_SDK_WS` pointing at the relay.
- **Railway / multi-host** — set `UNIVER_SDK_WS` to the reachable WebSocket URL for that instance; browser and agent must reach the **same** relay.
