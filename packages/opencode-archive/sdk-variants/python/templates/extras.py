from __future__ import annotations

from typing import AsyncIterator, Dict, Iterator, Optional

import httpx

from opencode_ai.api.default import config_get, session_list
from opencode_ai.client import Client
from opencode_ai.types import UNSET, Unset


class OpenCodeClient:
    """High-level convenience wrapper around the generated Client.

    Provides sensible defaults and a couple of helper methods.
    """

    def __init__(
        self,
        base_url: str = "http://localhost:4096",
        *,
        headers: Optional[Dict[str, str]] = None,
        timeout: Optional[float] = None,
        verify_ssl: bool | str | httpx.URLTypes | None = True,
    ) -> None:
        httpx_timeout = None if timeout is None else httpx.Timeout(timeout)
        self._client = Client(
            base_url=base_url,
            headers=headers or {},
            timeout=httpx_timeout,
            verify_ssl=verify_ssl if isinstance(verify_ssl, bool) else True,
        )

    @property
    def client(self) -> Client:
        return self._client

    # ---- Convenience wrappers over generated endpoints ----

    def list_sessions(self, *, directory: str | Unset = UNSET):
        return session_list.sync(client=self._client, directory=directory)

    def get_config(self, *, directory: str | Unset = UNSET):
        return config_get.sync(client=self._client, directory=directory)

    # ---- Server-Sent Events (SSE) streaming ----

    def subscribe_events(self, *, directory: str | Unset = UNSET) -> Iterator[dict]:
        """Subscribe to /event SSE endpoint and yield parsed JSON events.

        This is a blocking generator which yields one event dict per message.
        """
        client = self._client.get_httpx_client()
        params: dict[str, str] = {}
        if directory is not UNSET and directory is not None:
            params["directory"] = str(directory)
        with client.stream("GET", "/event", headers={"Accept": "text/event-stream"}, params=params) as r:
            r.raise_for_status()
            buf = ""
            for line_bytes in r.iter_lines():
                line = line_bytes.decode("utf-8") if isinstance(line_bytes, (bytes, bytearray)) else str(line_bytes)
                if line.startswith(":"):
                    # comment/heartbeat
                    continue
                if line == "":
                    if buf:
                        # end of event
                        for part in buf.split("\n"):
                            if part.startswith("data:"):
                                data = part[5:].strip()
                                if data:
                                    try:
                                        yield httpx._models.jsonlib.loads(data)  # type: ignore[attr-defined]
                                    except Exception:
                                        # fall back: skip malformed
                                        pass
                        buf = ""
                    continue
                buf += line + "\n"

    async def subscribe_events_async(self, *, directory: str | Unset = UNSET) -> AsyncIterator[dict]:
        """Async variant of subscribe_events using httpx.AsyncClient."""
        aclient = self._client.get_async_httpx_client()
        params: dict[str, str] = {}
        if directory is not UNSET and directory is not None:
            params["directory"] = str(directory)
        async with aclient.stream("GET", "/event", headers={"Accept": "text/event-stream"}, params=params) as r:
            r.raise_for_status()
            buf = ""
            async for line_bytes in r.aiter_lines():
                line = line_bytes
                if line.startswith(":"):
                    continue
                if line == "":
                    if buf:
                        for part in buf.split("\n"):
                            if part.startswith("data:"):
                                data = part[5:].strip()
                                if data:
                                    try:
                                        yield httpx._models.jsonlib.loads(data)  # type: ignore[attr-defined]
                                    except Exception:
                                        pass
                        buf = ""
                    continue
                buf += line + "\n"
