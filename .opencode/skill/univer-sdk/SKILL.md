---
name: univer-sdk
description: Edit the live Univer spreadsheet from Python (pyodide tool). Use sdk_help() for signatures. Relay path is only for MCP/external agents.
---

# Univer Python SDK (pyodide tool)

Control the **open spreadsheet in this browser tab**. Not server Python.

## Before you write code

1. Spreadsheet open in the same tab as the pyodide tool.
2. Run `print(sdk_help())` or `help(UniverSDK)` if unsure about parameters.
3. **Never** `asyncio.run(main())` — only `async def main():` (the tool runs `main` for you).

## Minimal pattern (copy this)

```python
from veritly_univer_sdk import CHART_BAR, RangeRect, UniverSDK, sdk_help

async def main() -> None:
    sdk = UniverSDK()
    await sdk.connect()
    doc = await sdk.get_active_document()
    rows = await sdk.get_sheet(sheet_id=doc.sheetId, max_row=50, max_col=10)
    print(rows)
    await sdk.set_range(
        RangeRect(0, 0, 0, 1),
        [["A", "B"]],
        sheet_id=doc.sheetId,
    )
```

## Reading cells

| Goal | Call |
|------|------|
| Known rectangle | `await sdk.get_range(RangeRect(r0, r1, c0, c1), sheet_id=...)` |
| “Most of the sheet” | `await sdk.get_sheet(max_row=200, max_col=30)` — top-left block, not unbounded |
| Helper from origin | `RangeRect.block(99, 25)` → rows 0–99, cols 0–25 |

`get_range(None)` is invalid. There is no magic “all data” without choosing bounds.

## Charts (`add_chart`)

```python
await sdk.add_chart(
    RangeRect(0, 10, 0, 3),
    sheet_id=doc.sheetId,
    chart_type=CHART_BAR,  # int 4, not "bar"
    anchor={"row": 12, "column": 0},
)
```

- **One** `range_rect` for the data block (header + values in the same rectangle).
- No `title`. No separate `label_range` / `data_range` — use `execute_command` for advanced drawing APIs.
- `chart_type` is an **integer** (default `CHART_BAR = 4`).

## API reference

| Method | Notes |
|--------|--------|
| `sdk_help()` | Printable cheat sheet |
| `get_active_document()` | `unitId`, `sheetId`, `sheetName` |
| `list_sheets()` | |
| `get_range(range_rect, sheet_id=None)` | Required `RangeRect` |
| `get_sheet(sheet_id=None, max_row=500, max_col=50)` | Large top-left read |
| `set_range(range_rect, values, sheet_id=None)` | 2D values aligned to range |
| `add_chart(range_rect, sheet_id=None, *, chart_type=4, anchor=None)` | Returns `{chartId}` |
| `inspect_facade(...)` | Browser facade method names |
| `execute_command(id, params)` | Low-level Univer command |

JSON wire format: `packages/univer-sdk/python/INTERFACE.md`.

## Errors

| Message | Fix |
|---------|-----|
| `asyncio.run() cannot be called from a running event loop` | Remove `asyncio.run(...)`; keep only `async def main()` |
| `No in-page Univer bridge` | Open a spreadsheet in this tab, then `await sdk.connect()` |
| `UniverSDK is not connected` | `await sdk.connect()` first |

## Relay / MCP (not pyodide)

External agents use WebSocket relay (`packages/relay`, `VITE_UNIVER_SDK_WS`). Local CPython: `bash packages/univer-sdk/python/install-local.sh`, then `asyncio.run(main())` is OK outside Pyodide.
