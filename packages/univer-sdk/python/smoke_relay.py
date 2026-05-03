#!/usr/bin/env python3
"""
Sanity check: relay HTTP + agent WebSocket + browser must answer get_active_document.

  bash packages/univer-sdk/python/install-local.sh
  # start relay on same port as UNIVER_SDK_WS (default ws://127.0.0.1:18766/ws)
  # open app session with spreadsheet tab
  python3 packages/univer-sdk/python/smoke_relay.py
"""
from __future__ import annotations

import asyncio
import json
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from veritly_univer_sdk import RangeRect, UniverSDK, UniverSDKError, default_agent_ws_url


def _readyz_url(ws: str) -> str:
    u = urlparse(ws)
    scheme = "https" if u.scheme in ("wss", "https") else "http"
    host = u.hostname or "127.0.0.1"
    port = u.port or (443 if scheme == "https" else 80)
    return f"{scheme}://{host}:{port}/readyz"


def _probe_readyz(ws: str) -> dict[str, object]:
    url = _readyz_url(ws)
    req = Request(url, headers={"accept": "application/json"})
    with urlopen(req, timeout=5) as r:
        return json.loads(r.read().decode())


async def main() -> int:
    ws = default_agent_ws_url(None)
    print(f"agent ws (default): {ws}")

    try:
        body = _probe_readyz(ws)
        print(f"relay /readyz: {json.dumps(body, indent=2)}")
    except HTTPError as e:
        print(f"relay HTTP {e.code} from {_readyz_url(ws)} — is the relay running on that port?")
        return 1
    except URLError as e:
        print(f"relay not reachable at {_readyz_url(ws)}: {e.reason}")
        print("Fix: start the relay on the same host/port (e.g. UNIVER_SDK_PORT=18766).")
        return 1

    if not body.get("ok"):
        print("relay reported not ok")
        return 1

    sdk = UniverSDK()
    try:
        await sdk.connect()
    except Exception as e:
        print(f"WebSocket connect failed: {e}")
        return 1

    print("agent WebSocket connected")

    try:
        doc = await sdk.get_active_document()
    except UniverSDKError as e:
        print(f"get_active_document failed: {e}")
        print("Typical causes: no browser connected as role=browser, or spreadsheet tab not open in this app.")
        await sdk.close()
        return 1

    print(f"active document: unitId={doc.unitId} sheetId={doc.sheetId} sheetName={doc.sheetName!r}")

    rows = await sdk.get_range(
        RangeRect(startRow=0, endRow=5, startColumn=0, endColumn=3),
        sheet_id=doc.sheetId,
    )
    print(f"get_range (0..5 x 0..3): {rows!r}")
    await sdk.close()
    print("ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
