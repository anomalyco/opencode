from __future__ import annotations

import httpx
import pytest

from opencode_sdk import create_opencode_client
from opencode_sdk.client import OpencodeClient
from opencode_sdk.error import OpencodeError


def test_create_client_defaults() -> None:
    client = create_opencode_client()
    assert client.base_url == "http://127.0.0.1:4096"
    assert client.directory is None


def test_create_client_with_options() -> None:
    client = create_opencode_client(
        base_url="http://localhost:8080",
        directory="/home/user/project",
        timeout=10.0,
    )
    assert client.base_url == "http://localhost:8080"
    assert client.directory == "/home/user/project"


def test_health_success() -> None:
    client = OpencodeClient(
        base_url="http://localhost:9999",
        httpx_client=httpx.Client(
            transport=httpx.MockTransport(
                lambda _: httpx.Response(200, json={"ok": True})
            )
        ),
    )
    result = client.health()
    assert result == {"ok": True}


def test_health_error() -> None:
    client = OpencodeClient(
        base_url="http://localhost:9999",
        httpx_client=httpx.Client(
            transport=httpx.MockTransport(
                lambda _: httpx.Response(500, json={"message": "internal error"})
            )
        ),
    )
    with pytest.raises(OpencodeError) as exc:
        client.health()
    assert exc.value.status == 500
    assert "internal error" in str(exc.value)


def test_merge_params_with_directory() -> None:
    client = OpencodeClient(base_url="http://localhost:9999", directory="/proj")
    result = client._merge_params({"foo": "bar"})
    assert result == {"foo": "bar", "directory": "/proj"}


def test_merge_params_with_workspace() -> None:
    client = OpencodeClient(base_url="http://localhost:9999", workspace="ws-1")
    result = client._merge_params({})
    assert result == {"workspace": "ws-1"}


def test_session_prompt_wraps_string() -> None:
    client = OpencodeClient(
        base_url="http://localhost:9999",
        httpx_client=httpx.Client(
            transport=httpx.MockTransport(
                lambda _: httpx.Response(200, json={"result": "ok"}),
            )
        ),
    )
    result = client.session_prompt("sess-1", "hello")
    assert result == {"result": "ok"}
