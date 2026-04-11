# Veritly Univer SDK Interface

This file is the API contract for Python/AI clients talking to the local relay and the live Univer runtime.

## Transport

- WebSocket URL (agent): `ws://127.0.0.1:18766/ws?role=agent` (relay default port `18766`, overridable via `UNIVER_SDK_PORT` on the Bun relay).
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
