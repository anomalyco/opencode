import json
from typing import Iterator

import httpx
import pytest

from opencode_ai import OpenCodeClient
from opencode_ai.api.default import config_get
from opencode_ai.client import Client


class _State:
    def __init__(self):
        self.calls = 0


def test_imports_and_methods_available() -> None:
    w = OpenCodeClient()
    assert hasattr(w, "list_sessions")
    assert hasattr(w, "get_config")
    assert hasattr(w, "list_agents")
    assert hasattr(w, "list_projects")
    assert hasattr(w, "current_project")
    assert hasattr(w, "file_status")
    assert hasattr(w, "get_path")
    assert hasattr(w, "subscribe_events")


def test_get_path_with_mock_transport() -> None:
    # Arrange a mock transport for GET /path
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/path"
        return httpx.Response(
            200,
            json={
                "state": "ok",
                "config": "/tmp/config",
                "worktree": "/repo",
                "directory": "/repo/project",
            },
        )

    transport = httpx.MockTransport(handler)

    w = OpenCodeClient(base_url="http://test")
    client = httpx.Client(base_url="http://test", transport=transport)
    w.client.set_httpx_client(client)

    # Act
    result = w.get_path()

    # Assert
    assert result is not None
    assert result.directory == "/repo/project"


def test_retry_on_request_error_then_success() -> None:
    state = _State()

    def handler(request: httpx.Request) -> httpx.Response:
        if state.calls == 0:
            state.calls += 1
            raise httpx.ConnectError("boom", request=request)
        return httpx.Response(
            200,
            json={
                "state": "ok",
                "config": "/tmp/config",
                "worktree": "/repo",
                "directory": "/repo/project",
            },
        )

    transport = httpx.MockTransport(handler)

    w = OpenCodeClient(base_url="http://test", retries=1, backoff_factor=0)
    client = httpx.Client(base_url="http://test", transport=transport)
    w.client.set_httpx_client(client)

    result = w.get_path()
    assert result is not None
    assert result.directory == "/repo/project"


def test_generated_config_get_via_mock() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/config"
        return httpx.Response(200, json={})

    transport = httpx.MockTransport(handler)
    c = Client(base_url="http://test")
    c.set_httpx_client(httpx.Client(base_url="http://test", transport=transport))
    assert config_get.sync(client=c) is not None


def test_sse_streaming_parses_events() -> None:
    # Prepare a simple SSE payload with one event
    payload = b'data: {"type":"server.connected"}\n\n'

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/event"
        return httpx.Response(
            200,
            headers={"Content-Type": "text/event-stream"},
            content=payload,
        )

    transport = httpx.MockTransport(handler)
    w = OpenCodeClient(base_url="http://test")
    client = httpx.Client(base_url="http://test", transport=transport)
    w.client.set_httpx_client(client)

    it = w.subscribe_events()
    first = next(it)
    assert isinstance(first, dict)
    assert first.get("type") == "server.connected"
