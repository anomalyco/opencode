"""End-to-end example: spawn a local opencode server, hit a few endpoints.

Run with:
    pip install -e packages/sdk/python
    python packages/sdk/python/examples/basic_usage.py
"""

from __future__ import annotations

import socket

from opencode_ai import Client, ServerOptions, create_opencode_server
from opencode_ai.api.default import global_health, session_create, session_list
from opencode_ai.models import SessionCreateBody


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def main() -> None:
    options = ServerOptions(port=_free_port(), timeout=15.0)
    with create_opencode_server(options) as server:
        client = Client(base_url=server.url, raise_on_unexpected_status=True)

        health = global_health.sync(client=client)
        print(f"opencode {health.version} healthy={health.healthy}")

        created = session_create.sync(client=client, body=SessionCreateBody(title="opencode-ai example"))
        print(f"created session {created.id}")

        listing = session_list.sync(client=client)
        sessions = listing if isinstance(listing, list) else getattr(listing, "sessions", listing)
        print(f"server reports {len(sessions)} session(s)")


if __name__ == "__main__":
    main()
