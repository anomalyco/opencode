from __future__ import annotations

import time
from typing import AsyncIterator, Dict, Iterator, Optional

import httpx

from .api.default import (
    app_agents,
    command_list,
    config_get,
    config_providers,
    file_status,
    path_get,
    project_current,
    project_list,
    session_list,
    tool_ids,
)
from .client import Client
from .types import UNSET, Unset


class OpenCodeClient:
    """High-level convenience wrapper around the generated Client.

    Provides sensible defaults and a couple of helper methods, with optional retries.
    """

    def __init__(
        self,
        base_url: str = "http://localhost:4096",
        *,
        headers: Optional[Dict[str, str]] = None,
        timeout: Optional[float] = None,
        verify_ssl: bool | str | httpx.URLTypes | None = True,
        token: Optional[str] = None,
        auth_header_name: str = "Authorization",
        auth_prefix: str = "Bearer",
        retries: int = 0,
        backoff_factor: float = 0.5,
        status_forcelist: tuple[int, ...] = (429, 500, 502, 503, 504),
    ) -> None:
        httpx_timeout = None if timeout is None else httpx.Timeout(timeout)
        all_headers = dict(headers or {})
        if token:
            all_headers[auth_header_name] = f"{auth_prefix} {token}".strip()
        self._client = Client(
            base_url=base_url,
            headers=all_headers,
            timeout=httpx_timeout,
            verify_ssl=verify_ssl if isinstance(verify_ssl, bool) else True,
        )
        self._retries = max(0, int(retries))
        self._backoff = float(backoff_factor)
        self._status_forcelist = set(status_forcelist)

    @property
    def client(self) -> Client:
        return self._client

    # ---- Internal retry helper ----

    def _call_with_retries(self, fn, *args, **kwargs):
        attempt = 0
        while True:
            try:
                return fn(*args, **kwargs)
            except httpx.RequestError:
                pass
            except httpx.HTTPStatusError as e:
                if e.response is None or e.response.status_code not in self._status_forcelist:
                    raise
            if attempt >= self._retries:
                # re-raise last exception if we have one
                raise
            sleep = self._backoff * (2**attempt)
            time.sleep(sleep)
            attempt += 1

    # ---- Convenience wrappers over generated endpoints ----

    def list_sessions(self, *, directory: str | Unset = UNSET):
        """Return sessions in the current project.

        Wraps GET /session. Pass `directory` to target a specific project/directory if needed.
        """
        return self._call_with_retries(session_list.sync, client=self._client, directory=directory)

    def get_config(self, *, directory: str | Unset = UNSET):
        """Return opencode configuration for the current project (GET /config)."""
        return self._call_with_retries(config_get.sync, client=self._client, directory=directory)

    def list_agents(self, *, directory: str | Unset = UNSET):
        """List configured agents (GET /agent)."""
        return self._call_with_retries(app_agents.sync, client=self._client, directory=directory)

    def list_projects(self, *, directory: str | Unset = UNSET):
        """List known projects (GET /project)."""
        return self._call_with_retries(project_list.sync, client=self._client, directory=directory)

    def current_project(self, *, directory: str | Unset = UNSET):
        """Return current project (GET /project/current)."""
        return self._call_with_retries(project_current.sync, client=self._client, directory=directory)

    def file_status(self, *, directory: str | Unset = UNSET):
        """Return file status list (GET /file/status)."""
        return self._call_with_retries(file_status.sync, client=self._client, directory=directory)

    def get_path(self, *, directory: str | Unset = UNSET):
        """Return opencode path info (GET /path)."""
        return self._call_with_retries(path_get.sync, client=self._client, directory=directory)

    def config_providers(self, *, directory: str | Unset = UNSET):
        """Return configured providers (GET /config/providers)."""
        return self._call_with_retries(config_providers.sync, client=self._client, directory=directory)

    def tool_ids(self, *, directory: str | Unset = UNSET):
        """Return tool identifiers for a provider/model pair (GET /experimental/tool)."""
        return self._call_with_retries(tool_ids.sync, client=self._client, directory=directory)

    def list_commands(self, *, directory: str | Unset = UNSET):
        """List commands (GET /command)."""
        return self._call_with_retries(command_list.sync, client=self._client, directory=directory)

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
