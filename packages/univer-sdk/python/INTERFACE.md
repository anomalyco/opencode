# Veritly Univer SDK Interface

This file is the API contract for Python/AI clients talking to the local relay and the live Univer runtime.

## Transport

- WebSocket URL (agent): `ws://127.0.0.1:18766/ws?role=agent` (relay default port `18766` when `PORT` / `UNIVER_SDK_PORT` are unset; Docker/k8s images set `PORT=8080` explicitly).
- Python `UniverSDK` defaults: no-arg constructor → `UNIVER_SDK_WS` env if set, else `ws://127.0.0.1:{UNIVER_SDK_PORT}/ws` with `UNIVER_SDK_PORT` defaulting to `18766`.
- After each request, Python waits for one JSON response on the same socket. If the browser never answers (tab closed, sheet not loaded, main thread stuck), that wait can hang. `UNIVER_SDK_CALL_TIMEOUT_SEC` caps this wait (default `30`).
- Request JSON: `{ "id": "<string>", "op": "<operation>", "params": { ... } }`
- Response JSON: `{ "id": "<string>", "ok": true, "result": <any> }` or `{ "id": "<string>", "ok": false, "error": "<message>" }`

## Types

`RangeRect`

```json
{
  "startRow": 0,
  "endRow": 4,
  "startColumn": 0,
  "endColumn": 1
}
```

## Operations

### `get_active_document`

- params: none
- result:

```json
{
  "unitId": "diK6EKOqsLludOJvotp",
  "sheetId": "uni1",
  "sheetName": "Sheet1"
}
```

### `list_sheets`

- params: none
- result:

```json
[
  { "id": "uni1", "name": "Sheet1" },
  { "id": "uni2", "name": "Sheet2" }
]
```

### `get_range`

- params:

```json
{
  "sheetId": "uni1",
  "range": {
    "startRow": 0,
    "endRow": 2,
    "startColumn": 0,
    "endColumn": 2
  }
}
```

- result: `unknown[][]` (2D array of cell values or null)

### `set_range`

- params:

```json
{
  "sheetId": "uni1",
  "range": {
    "startRow": 0,
    "endRow": 1,
    "startColumn": 0,
    "endColumn": 1
  },
  "values": [
    ["Name", "Value"],
    ["Revenue", 123]
  ]
}
```

- result: `true`

### `add_chart`

- params:

```json
{
  "sheetId": "uni1",
  "range": {
    "startRow": 0,
    "endRow": 4,
    "startColumn": 0,
    "endColumn": 1
  },
  "type": 4,
  "anchor": { "row": 6, "column": 3 }
}
```

- result: `true`

### `sdk_introspect`

- params (optional):

```json
{
  "sheetId": "uni1",
  "range": {
    "startRow": 0,
    "endRow": 0,
    "startColumn": 0,
    "endColumn": 0
  }
}
```

- result: object with `apiMethods`, `workbookMethods`, `sheetMethods`, `rangeMethods` (string arrays of callable names on the live facade).

### `execute_command`

- params:

```json
{
  "id": "sheet.command.insert-sheet-image",
  "params": {}
}
```

- `id` (required): Univer command id passed to `univerAPI.executeCommand`.
- `params` (optional): plain object; omit or `{}` when not needed.
- result: command-specific (Univer).

## Troubleshooting (local CPython “doesn’t work”)

1. **Same Python you installed**  
   Run scripts with the same interpreter you used for `install-local.sh`, e.g. `python3 myscript.py` after `python3 -m pip install -e ...`. A different `python` on PATH may not see `veritly_univer_sdk`.

2. **Relay reachable on the URL Python uses**  
   Defaults: relay listens on `PORT` or `UNIVER_SDK_PORT` or **18766**; Python defaults to `ws://127.0.0.1:18766/ws` unless `UNIVER_SDK_WS` is set. If you start the relay with only `PORT=8080`, set `export UNIVER_SDK_WS=ws://127.0.0.1:8080/ws` (or `UNIVER_SDK_PORT=8080`) before running Python.

3. **Browser must be connected before RPCs**  
   Open a Veritly session and the **spreadsheet** tab so the app opens `VITE_UNIVER_SDK_WS?role=browser`. Relay `/readyz` should show `"browserConnected": true`. If it is `false`, Python gets `browser is not connected` or hangs until timeout.

4. **Smoke test**  
   From repo root: `python3 packages/univer-sdk/python/smoke_relay.py` — checks `/readyz`, agent WebSocket, `get_active_document`, and a small `get_range`.

5. **Timeouts**  
   If the tab is open but busy, increase `UNIVER_SDK_CALL_TIMEOUT_SEC` (default `30`).
