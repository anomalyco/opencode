"""End-to-end smoke tests that talk to a live `opencode serve` process.

Skipped unless an `opencode` binary is on $PATH. The fixture spawns the
server on an ephemeral port and tears it down afterwards; the tests assert
real schema-conformant behavior on a few representative endpoints.
"""

from __future__ import annotations

import shutil
import socket

import pytest

from opencode_ai import Client, ServerOptions, create_opencode_server
from opencode_ai.api.default import (
    config_get,
    global_health,
    session_create,
    session_delete,
    session_list,
)
from opencode_ai.models import SessionCreateBody

OPENCODE_BIN = shutil.which("opencode")
pytestmark = pytest.mark.skipif(OPENCODE_BIN is None, reason="opencode binary not on $PATH")


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def server():
    handle = create_opencode_server(ServerOptions(port=_free_port(), timeout=15.0, binary=OPENCODE_BIN or "opencode"))
    try:
        yield handle
    finally:
        handle.close()


@pytest.fixture(scope="module")
def client(server):
    return Client(base_url=server.url, raise_on_unexpected_status=True)


def test_health(client):
    health = global_health.sync(client=client)
    assert health is not None
    assert health.healthy is True
    assert isinstance(health.version, str)
    assert health.version


def test_config(client):
    cfg = config_get.sync(client=client)
    assert cfg is not None


async def test_async_server_and_health():
    from opencode_ai import AsyncServerHandle, ServerOptions
    from opencode_ai.api.default import global_health
    from opencode_ai.client import Client

    options = ServerOptions(
        port=_free_port(),
        timeout=15.0,
        binary=OPENCODE_BIN or "opencode",
    )
    async with await AsyncServerHandle.create(options) as server:
        c = Client(base_url=server.url, raise_on_unexpected_status=True)
        result = await global_health.asyncio(client=c)
        assert result is not None
        assert result.healthy is True


def test_session_lifecycle(client):
    created = session_create.sync(
        client=client,
        body=SessionCreateBody(title="opencode-ai sdk smoke test"),
    )
    assert created is not None
    sid = getattr(created, "id", None)
    assert isinstance(sid, str)
    try:
        listing = session_list.sync(client=client)
        assert listing is not None
        sessions = listing if isinstance(listing, list) else getattr(listing, "sessions", listing)
        ids = [getattr(s, "id", None) for s in sessions]
        assert sid in ids, f"created session id {sid} missing from list"
    finally:
        session_delete.sync(client=client, session_id=sid)
