"""
Veritly Univer SDK — control the live spreadsheet from Python.

Pyodide (pyodide tool): ``await UniverSDK().connect()`` uses ``window.__veritlyUniverBridge``.
Open a spreadsheet in the same tab first. Do **not** call ``asyncio.run()``; use ``async def main():`` only.

Relay (MCP / CPython): ``UniverSDK(ws_url)`` over WebSocket — see ``sdk_help()`` and SKILL.md relay section.

Quick help: ``print(sdk_help())`` or ``help(UniverSDK)``.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import uuid
from dataclasses import dataclass
from typing import Any

_PYODIDE = sys.platform == "emscripten"

if not _PYODIDE:
    import websockets

# Univer chartType integers (not strings). Default in add_chart is CHART_BAR.
CHART_BAR = 4

SDK_HELP = """\
Veritly Univer SDK — cheat sheet for agents

## Pyodide (pyodide tool) — usual path
- Spreadsheet must be open in this browser tab.
- async def main(): ...   # tool runs main for you
- Do NOT use asyncio.run(main()) — raises "cannot be called from a running event loop".
- sdk = UniverSDK(); await sdk.connect()

## Reading data
- get_range(range_rect, sheet_id=None) — range_rect is required (no None).
- get_sheet(sheet_id=None, max_row=500, max_col=50) — reads top-left block (0..max_row, 0..max_col).
- RangeRect.block(end_row, end_column) — helper from origin, e.g. RangeRect.block(99, 25).

## Writing
- set_range(range_rect, values, sheet_id=None) — values is 2D list aligned to range.

## Charts (add_chart)
- One range_rect: contiguous block (often header row + data in same rectangle).
- chart_type: int (CHART_BAR = 4), not "bar".
- No title parameter. No separate label_range / data_range — use one range or execute_command.
- anchor: optional {"row": int, "column": int} for chart position on sheet.
- Returns dict with chartId on success.

## Discovery
- print(sdk_help()) — this text
- help(UniverSDK), help(RangeRect), inspect.signature(sdk.add_chart)
- await sdk.inspect_facade() — facade method names in the browser runtime

## Relay-only (MCP / local CPython)
- UniverSDK() uses UNIVER_SDK_WS or ws://127.0.0.1:18766/ws?role=agent
- Browser tab must connect relay as role=browser (VITE_UNIVER_SDK_WS)
"""


def sdk_help() -> str:
    return SDK_HELP


@dataclass(frozen=True)
class RangeRect:
    """Inclusive row/column indices on the sheet (0-based)."""

    startRow: int
    endRow: int
    startColumn: int
    endColumn: int

    @classmethod
    def block(cls, end_row: int, end_column: int) -> RangeRect:
        """Rectangle from (0,0) through (end_row, end_column) inclusive."""
        if end_row < 0 or end_column < 0:
            raise ValueError("end_row and end_column must be >= 0")
        return cls(0, end_row, 0, end_column)


@dataclass(frozen=True)
class ActiveDocument:
    unitId: str
    sheetId: str
    sheetName: str


@dataclass(frozen=True)
class SheetMeta:
    id: str
    name: str


class UniverSDKError(RuntimeError):
    pass


def _call_timeout_sec() -> float:
    raw = os.environ.get("UNIVER_SDK_CALL_TIMEOUT_SEC", "30").strip()
    try:
        v = float(raw)
        return v if v > 0 else 30.0
    except ValueError:
        return 30.0


def _resolve_ws_url(explicit: str | None) -> str:
    if explicit is not None:
        return explicit.strip()
    env = os.environ.get("UNIVER_SDK_WS", "").strip()
    if env:
        return env
    port = os.environ.get("UNIVER_SDK_PORT", "18766").strip()
    return f"ws://127.0.0.1:{port}/ws"


def default_agent_ws_url(explicit: str | None = None) -> str:
    return _resolve_ws_url(explicit)


def _pyodide_bridge() -> Any | None:
    import js

    bridge = getattr(js.window, "__veritlyUniverBridge", None)
    if bridge is None:
        return None
    if not hasattr(bridge, "call"):
        return None
    return bridge


async def _inprocess_connect() -> Any:
    bridge = _pyodide_bridge()
    if bridge is None:
        raise UniverSDKError(
            "No in-page Univer bridge. Open a spreadsheet in this tab before using UniverSDK."
        )

    class Conn:
        __slots__ = ("_bridge", "_pending")

        def __init__(self, b: Any) -> None:
            self._bridge = b
            self._pending: str | None = None

        async def send(self, data: str) -> None:
            raw = await self._bridge.call(data)
            self._pending = str(raw)

        async def recv(self) -> str:
            if self._pending is None:
                raise UniverSDKError("in-process Univer bridge: recv without send")
            out = self._pending
            self._pending = None
            return out

        async def close(self) -> None:
            self._pending = None

    return Conn(bridge)


class UniverSDK:
    """Async client for the open Univer sheet. Call ``await connect()`` before other methods."""

    def __init__(self, ws_url: str | None = None) -> None:
        """
        Pyodide: ignore ws_url; uses in-page bridge.
        Relay: optional WebSocket URL (else UNIVER_SDK_WS / UNIVER_SDK_PORT).
        """
        self._ws_url = _resolve_ws_url(ws_url)
        self._conn: Any = None
        self._lock = asyncio.Lock()

    async def connect(self) -> None:
        if self._conn is not None:
            return
        if _PYODIDE:
            self._conn = await _inprocess_connect()
            return
        url = self._ws_url if "?" in self._ws_url else f"{self._ws_url}?role=agent"
        if "role=" not in url:
            url = f"{url}&role=agent"
        self._conn = await websockets.connect(url)

    async def close(self) -> None:
        if self._conn is None:
            return
        await self._conn.close()
        self._conn = None

    async def get_active_document(self) -> ActiveDocument:
        data = await self._call("get_active_document")
        return ActiveDocument(
            unitId=str(data["unitId"]),
            sheetId=str(data["sheetId"]),
            sheetName=str(data["sheetName"]),
        )

    async def list_sheets(self) -> list[SheetMeta]:
        data = await self._call("list_sheets")
        return [SheetMeta(id=str(x["id"]), name=str(x["name"])) for x in data]

    async def get_range(self, range_rect: RangeRect, sheet_id: str | None = None) -> list[list[Any]]:
        """Read a rectangular block. ``range_rect`` is required — use ``get_sheet()`` for a large top-left read."""
        return await self._call(
            "get_range",
            {
                "sheetId": sheet_id,
                "range": {
                    "startRow": range_rect.startRow,
                    "endRow": range_rect.endRow,
                    "startColumn": range_rect.startColumn,
                    "endColumn": range_rect.endColumn,
                },
            },
        )

    async def get_sheet(
        self,
        sheet_id: str | None = None,
        *,
        max_row: int = 500,
        max_col: int = 50,
    ) -> list[list[Any]]:
        """Read rows 0..max_row and columns 0..max_col (inclusive). Trailing empty cells may be null."""
        if max_row < 0 or max_col < 0:
            raise ValueError("max_row and max_col must be >= 0")
        return await self.get_range(RangeRect.block(max_row, max_col), sheet_id=sheet_id)

    async def set_range(self, range_rect: RangeRect, values: list[list[Any]], sheet_id: str | None = None) -> bool:
        result = await self._call(
            "set_range",
            {
                "sheetId": sheet_id,
                "range": {
                    "startRow": range_rect.startRow,
                    "endRow": range_rect.endRow,
                    "startColumn": range_rect.startColumn,
                    "endColumn": range_rect.endColumn,
                },
                "values": values,
            },
        )
        return bool(result)

    async def add_chart(
        self,
        range_rect: RangeRect,
        sheet_id: str | None = None,
        *,
        chart_type: int = CHART_BAR,
        anchor: dict[str, int] | None = None,
    ) -> dict[str, Any]:
        """
        Insert a chart from one contiguous cell range (data + optional header row in the same block).

        Args:
            range_rect: Inclusive cell bounds for chart data (not separate label/value ranges).
            sheet_id: Target sheet; default active sheet.
            chart_type: Univer integer type (default CHART_BAR = 4), not a string name.
            anchor: Optional sheet position ``{"row": int, "column": int}`` for the chart float.

        Returns:
            Dict with ``chartId`` on success. No ``title`` parameter on this API.
        """
        params: dict[str, Any] = {
            "sheetId": sheet_id,
            "range": {
                "startRow": range_rect.startRow,
                "endRow": range_rect.endRow,
                "startColumn": range_rect.startColumn,
                "endColumn": range_rect.endColumn,
            },
            "type": chart_type,
        }
        if anchor is not None:
            params["anchor"] = anchor
        result = await self._call("add_chart", params)
        if isinstance(result, dict):
            return result
        return {"ok": bool(result)}

    async def inspect_facade(self, sheet_id: str | None = None, range_rect: RangeRect | None = None) -> dict[str, Any]:
        params: dict[str, Any] = {}
        if sheet_id is not None:
            params["sheetId"] = sheet_id
        if range_rect is not None:
            params["range"] = {
                "startRow": range_rect.startRow,
                "endRow": range_rect.endRow,
                "startColumn": range_rect.startColumn,
                "endColumn": range_rect.endColumn,
            }
        return await self._call("sdk_introspect", params or None)

    async def execute_command(self, command_id: str, params: dict[str, Any] | None = None) -> Any:
        return await self._call(
            "execute_command",
            {
                "id": command_id,
                "params": params or {},
            },
        )

    async def _call(self, op: str, params: dict[str, Any] | None = None) -> Any:
        if self._conn is None:
            raise UniverSDKError("UniverSDK is not connected. Call connect() first.")

        req_id = uuid.uuid4().hex
        payload: dict[str, Any] = {"id": req_id, "op": op}
        if params is not None:
            payload["params"] = params

        timeout = _call_timeout_sec()
        async with self._lock:
            await self._conn.send(json.dumps(payload))
            try:
                raw = await asyncio.wait_for(self._conn.recv(), timeout=timeout)
            except TimeoutError as e:
                hint = (
                    "spreadsheet may be closed or the main thread is busy"
                    if _PYODIDE
                    else "relay forwarded the request; browser tab may be closed, frozen, or not running the spreadsheet viewer"
                )
                raise UniverSDKError(
                    f"timed out after {timeout}s waiting for browser response to op={op!r} ({hint})"
                ) from e

        if not isinstance(raw, str):
            raise UniverSDKError("Received non-text response from Univer bridge.")

        data = json.loads(raw)
        if data.get("id") != req_id:
            raise UniverSDKError(f"Unexpected response id. expected={req_id} actual={data.get('id')}")
        if data.get("ok") is not True:
            raise UniverSDKError(str(data.get("error") or "Unknown Univer bridge error"))
        return data.get("result")


__all__ = [
    "CHART_BAR",
    "SDK_HELP",
    "ActiveDocument",
    "RangeRect",
    "SheetMeta",
    "UniverSDK",
    "UniverSDKError",
    "default_agent_ws_url",
    "sdk_help",
]
