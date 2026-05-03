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


@dataclass(frozen=True)
class RangeRect:
    startRow: int
    endRow: int
    startColumn: int
    endColumn: int


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
    """Default matches Bun `sdk-relay` (`UNIVER_SDK_PORT`, default 18766). Override with `UNIVER_SDK_WS`."""
    if explicit is not None:
        return explicit.strip()
    env = os.environ.get("UNIVER_SDK_WS", "").strip()
    if env:
        return env
    port = os.environ.get("UNIVER_SDK_PORT", "18766").strip()
    return f"ws://127.0.0.1:{port}/ws"


def default_agent_ws_url(explicit: str | None = None) -> str:
    """WebSocket URL the `UniverSDK` constructor would use (for diagnostics)."""
    return _resolve_ws_url(explicit)


async def _browser_ws_connect(url: str) -> Any:
    """Pyodide / Emscripten: browser WebSocket (same-origin rules as the host tab)."""
    from pyodide.ffi import create_proxy

    import js

    loop = asyncio.get_running_loop()
    ws = js.WebSocket.new(url)
    open_fut: asyncio.Future[None] = loop.create_future()
    incoming: asyncio.Queue[str | None] = asyncio.Queue()
    proxies: list[Any] = []

    def on_open(_event: object | None = None) -> None:
        if not open_fut.done():
            open_fut.set_result(None)

    def on_message(event: object) -> None:
        d = getattr(event, "data", "")
        if not isinstance(d, str):
            d = str(d)
        incoming.put_nowait(d)

    def on_error(_event: object | None = None) -> None:
        if not open_fut.done():
            open_fut.set_exception(UniverSDKError("WebSocket error"))
        incoming.put_nowait(None)

    def on_close(_event: object | None = None) -> None:
        if not open_fut.done():
            open_fut.set_exception(UniverSDKError("WebSocket closed before open"))
        incoming.put_nowait(None)

    proxies.append(create_proxy(on_open))
    proxies.append(create_proxy(on_message))
    proxies.append(create_proxy(on_error))
    proxies.append(create_proxy(on_close))

    ws.addEventListener("open", proxies[0])
    ws.addEventListener("message", proxies[1])
    ws.addEventListener("error", proxies[2])
    ws.addEventListener("close", proxies[3])

    await open_fut

    class Conn:
        __slots__ = ("_incoming", "_proxies", "_ws")

        def __init__(self) -> None:
            self._ws = ws
            self._incoming = incoming
            self._proxies = proxies

        async def send(self, data: str) -> None:
            self._ws.send(data)

        async def recv(self) -> str:
            item = await self._incoming.get()
            if item is None:
                raise UniverSDKError("WebSocket closed")
            return item

        async def close(self) -> None:
            try:
                self._ws.close(1000, "client close")
            finally:
                for p in self._proxies:
                    p.destroy()
                self._proxies.clear()

    return Conn()


class UniverSDK:
    def __init__(self, ws_url: str | None = None) -> None:
        self._ws_url = _resolve_ws_url(ws_url)
        self._conn: Any = None
        self._lock = asyncio.Lock()

    async def connect(self) -> None:
        if self._conn is not None:
            return
        url = self._ws_url if "?" in self._ws_url else f"{self._ws_url}?role=agent"
        if "role=" not in url:
            url = f"{url}&role=agent"
        if _PYODIDE:
            self._conn = await _browser_ws_connect(url)
            return
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
        chart_type: int | None = None,
        anchor: dict[str, int] | None = None,
    ) -> bool:
        params: dict[str, Any] = {
            "sheetId": sheet_id,
            "range": {
                "startRow": range_rect.startRow,
                "endRow": range_rect.endRow,
                "startColumn": range_rect.startColumn,
                "endColumn": range_rect.endColumn,
            },
        }
        if chart_type is not None:
            params["type"] = chart_type
        if anchor is not None:
            params["anchor"] = anchor
        result = await self._call("add_chart", params)
        return bool(result)

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
                raise UniverSDKError(
                    f"timed out after {timeout}s waiting for browser response to op={op!r} "
                    "(relay forwarded the request; browser tab may be closed, frozen, or not running the spreadsheet viewer)"
                ) from e

        if not isinstance(raw, str):
            raise UniverSDKError("Received non-text response from relay.")

        data = json.loads(raw)
        if data.get("id") != req_id:
            raise UniverSDKError(f"Unexpected response id. expected={req_id} actual={data.get('id')}")
        if data.get("ok") is not True:
            raise UniverSDKError(str(data.get("error") or "Unknown relay error"))
        return data.get("result")
