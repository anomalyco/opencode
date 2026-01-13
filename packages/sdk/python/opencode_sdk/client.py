"""HTTP client for OpenCode SDK.

This module provides the low-level HTTP client with SSE support.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator, Iterator
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import quote, urlencode, urljoin

import httpx
from httpx_sse import aconnect_sse, connect_sse


@dataclass
class ClientConfig:
    """Configuration for the OpenCode client."""

    base_url: str = "http://127.0.0.1:4096"
    timeout: float | None = None
    headers: dict[str, str] = field(default_factory=dict)
    directory: str | None = None

    def __post_init__(self) -> None:
        if self.directory:
            encoded = quote(self.directory) if not self.directory.isascii() else self.directory
            self.headers["x-opencode-directory"] = encoded


@dataclass
class Response[T]:
    """Response wrapper containing data or error."""

    data: T | None = None
    error: Any | None = None
    request: httpx.Request | None = None
    response: httpx.Response | None = None

    @property
    def ok(self) -> bool:
        return self.error is None and self.data is not None


class SseEvent[T]:
    """Server-sent event wrapper."""

    def __init__(
        self,
        data: T,
        event: str | None = None,
        id: str | None = None,
        retry: int | None = None,
    ) -> None:
        self.data = data
        self.event = event
        self.id = id
        self.retry = retry


class HttpClient:
    """Low-level HTTP client with SSE support."""

    def __init__(self, config: ClientConfig | None = None) -> None:
        self.config = config or ClientConfig()
        self._client: httpx.Client | None = None
        self._async_client: httpx.AsyncClient | None = None

    def _get_client(self) -> httpx.Client:
        if self._client is None:
            self._client = httpx.Client(
                base_url=self.config.base_url,
                timeout=self.config.timeout,
                headers=self.config.headers,
            )
        return self._client

    def _get_async_client(self) -> httpx.AsyncClient:
        if self._async_client is None:
            self._async_client = httpx.AsyncClient(
                base_url=self.config.base_url,
                timeout=self.config.timeout,
                headers=self.config.headers,
            )
        return self._async_client

    def close(self) -> None:
        if self._client:
            self._client.close()
            self._client = None

    async def aclose(self) -> None:
        if self._async_client:
            await self._async_client.aclose()
            self._async_client = None

    def _build_url(
        self,
        path: str,
        path_params: dict[str, str] | None = None,
        query_params: dict[str, Any] | None = None,
    ) -> str:
        url = path
        if path_params:
            for key, value in path_params.items():
                url = url.replace(f"{{{key}}}", str(value))
        if query_params:
            filtered = {k: v for k, v in query_params.items() if v is not None}
            if filtered:
                url = f"{url}?{urlencode(filtered)}"
        return url

    def request(
        self,
        method: str,
        path: str,
        *,
        path_params: dict[str, str] | None = None,
        query_params: dict[str, Any] | None = None,
        body: Any | None = None,
        headers: dict[str, str] | None = None,
    ) -> Response[Any]:
        client = self._get_client()
        url = self._build_url(path, path_params, query_params)
        req_headers = {**self.config.headers, **(headers or {})}

        if body is not None:
            req_headers["Content-Type"] = "application/json"

        try:
            response = client.request(
                method,
                url,
                json=body,
                headers=req_headers,
            )

            if response.is_success:
                if response.status_code == 204 or response.headers.get("Content-Length") == "0":
                    return Response(data={}, request=response.request, response=response)

                content_type = response.headers.get("Content-Type", "")
                if "application/json" in content_type:
                    data = response.json()
                else:
                    data = response.text

                return Response(data=data, request=response.request, response=response)

            try:
                error = response.json()
            except Exception:
                error = response.text

            return Response(error=error, request=response.request, response=response)

        except Exception as e:
            return Response(error=str(e))

    async def arequest(
        self,
        method: str,
        path: str,
        *,
        path_params: dict[str, str] | None = None,
        query_params: dict[str, Any] | None = None,
        body: Any | None = None,
        headers: dict[str, str] | None = None,
    ) -> Response[Any]:
        url = self._build_url(path, path_params, query_params)
        full_url = urljoin(self.config.base_url, url)
        req_headers = {**self.config.headers, **(headers or {})}

        if body is not None:
            req_headers["Content-Type"] = "application/json"

        try:
            async with httpx.AsyncClient(timeout=self.config.timeout) as client:
                async with client.stream(
                    method,
                    full_url,
                    json=body,
                    headers=req_headers,
                ) as response:
                    if response.is_success:
                        if response.status_code == 204:
                            return Response(data={}, request=response.request, response=response)

                        content = await response.aread()
                        if not content:
                            return Response(data={}, request=response.request, response=response)

                        content_type = response.headers.get("Content-Type", "")
                        if "application/json" in content_type:
                            data = json.loads(content)
                        else:
                            data = content.decode()

                        return Response(data=data, request=response.request, response=response)

                    content = await response.aread()
                    try:
                        error = json.loads(content)
                    except Exception:
                        error = content.decode() if content else "Unknown error"

                    return Response(error=error, request=response.request, response=response)

        except Exception as e:
            return Response(error=str(e))

    def get(
        self,
        path: str,
        *,
        path_params: dict[str, str] | None = None,
        query_params: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> Response[Any]:
        return self.request(
            "GET", path, path_params=path_params, query_params=query_params, headers=headers
        )

    async def aget(
        self,
        path: str,
        *,
        path_params: dict[str, str] | None = None,
        query_params: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> Response[Any]:
        return await self.arequest(
            "GET", path, path_params=path_params, query_params=query_params, headers=headers
        )

    def post(
        self,
        path: str,
        *,
        path_params: dict[str, str] | None = None,
        query_params: dict[str, Any] | None = None,
        body: Any | None = None,
        headers: dict[str, str] | None = None,
    ) -> Response[Any]:
        return self.request(
            "POST",
            path,
            path_params=path_params,
            query_params=query_params,
            body=body,
            headers=headers,
        )

    async def apost(
        self,
        path: str,
        *,
        path_params: dict[str, str] | None = None,
        query_params: dict[str, Any] | None = None,
        body: Any | None = None,
        headers: dict[str, str] | None = None,
    ) -> Response[Any]:
        return await self.arequest(
            "POST",
            path,
            path_params=path_params,
            query_params=query_params,
            body=body,
            headers=headers,
        )

    def put(
        self,
        path: str,
        *,
        path_params: dict[str, str] | None = None,
        query_params: dict[str, Any] | None = None,
        body: Any | None = None,
        headers: dict[str, str] | None = None,
    ) -> Response[Any]:
        return self.request(
            "PUT",
            path,
            path_params=path_params,
            query_params=query_params,
            body=body,
            headers=headers,
        )

    async def aput(
        self,
        path: str,
        *,
        path_params: dict[str, str] | None = None,
        query_params: dict[str, Any] | None = None,
        body: Any | None = None,
        headers: dict[str, str] | None = None,
    ) -> Response[Any]:
        return await self.arequest(
            "PUT",
            path,
            path_params=path_params,
            query_params=query_params,
            body=body,
            headers=headers,
        )

    def patch(
        self,
        path: str,
        *,
        path_params: dict[str, str] | None = None,
        query_params: dict[str, Any] | None = None,
        body: Any | None = None,
        headers: dict[str, str] | None = None,
    ) -> Response[Any]:
        return self.request(
            "PATCH",
            path,
            path_params=path_params,
            query_params=query_params,
            body=body,
            headers=headers,
        )

    async def apatch(
        self,
        path: str,
        *,
        path_params: dict[str, str] | None = None,
        query_params: dict[str, Any] | None = None,
        body: Any | None = None,
        headers: dict[str, str] | None = None,
    ) -> Response[Any]:
        return await self.arequest(
            "PATCH",
            path,
            path_params=path_params,
            query_params=query_params,
            body=body,
            headers=headers,
        )

    def delete(
        self,
        path: str,
        *,
        path_params: dict[str, str] | None = None,
        query_params: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> Response[Any]:
        return self.request(
            "DELETE", path, path_params=path_params, query_params=query_params, headers=headers
        )

    async def adelete(
        self,
        path: str,
        *,
        path_params: dict[str, str] | None = None,
        query_params: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> Response[Any]:
        return await self.arequest(
            "DELETE", path, path_params=path_params, query_params=query_params, headers=headers
        )

    def sse(
        self,
        path: str,
        *,
        path_params: dict[str, str] | None = None,
        query_params: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> Iterator[SseEvent[Any]]:
        """Subscribe to server-sent events (synchronous)."""
        url = self._build_url(path, path_params, query_params)
        full_url = urljoin(self.config.base_url, url)
        req_headers = {**self.config.headers, **(headers or {})}

        with httpx.Client(timeout=self.config.timeout) as client:
            with connect_sse(client, "GET", full_url, headers=req_headers) as event_source:
                for sse in event_source.iter_sse():
                    data: Any = sse.data
                    try:
                        data = json.loads(sse.data)
                    except (json.JSONDecodeError, TypeError):
                        pass

                    retry: int | None = None
                    if sse.retry is not None:
                        retry = sse.retry

                    yield SseEvent(
                        data=data,
                        event=sse.event if sse.event else None,
                        id=sse.id if sse.id else None,
                        retry=retry,
                    )

    async def asse(
        self,
        path: str,
        *,
        path_params: dict[str, str] | None = None,
        query_params: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> AsyncIterator[SseEvent[Any]]:
        """Subscribe to server-sent events (asynchronous)."""
        import asyncio

        url = self._build_url(path, path_params, query_params)
        full_url = urljoin(self.config.base_url, url)
        req_headers = {**self.config.headers, **(headers or {})}

        async with httpx.AsyncClient(timeout=self.config.timeout) as client:
            async with aconnect_sse(client, "GET", full_url, headers=req_headers) as event_source:
                try:
                    async for sse in event_source.aiter_sse():
                        data: Any = sse.data
                        try:
                            data = json.loads(sse.data)
                        except (json.JSONDecodeError, TypeError):
                            pass

                        retry: int | None = None
                        if sse.retry is not None:
                            retry = sse.retry

                        yield SseEvent(
                            data=data,
                            event=sse.event if sse.event else None,
                            id=sse.id if sse.id else None,
                            retry=retry,
                        )
                except asyncio.CancelledError:
                    return


def suppress_asyncgen_warnings() -> None:
    """Suppress asyncgen RuntimeError warnings from httpx-sse on shutdown.

    Call this at the start of your async code to prevent noisy warnings
    when SSE connections are cancelled during shutdown. This is a known
    limitation of httpx-sse library.

    Example:
        from opencode_sdk.client import suppress_asyncgen_warnings

        async def main():
            suppress_asyncgen_warnings()
            opencode = await create_opencode_async()
            ...
    """
    import asyncio

    try:
        loop = asyncio.get_event_loop()
    except RuntimeError:
        return

    original = loop.call_exception_handler

    def handler(context: dict[str, Any]) -> None:
        exc = context.get("exception")
        if isinstance(exc, RuntimeError):
            msg = str(exc)
            if "asynchronous generator is already running" in msg:
                return
        original(context)

    loop.call_exception_handler = handler  # type: ignore[method-assign]
