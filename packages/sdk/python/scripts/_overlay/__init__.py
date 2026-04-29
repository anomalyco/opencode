"""Python SDK for the opencode API.

Generated client code lives in `opencode_ai.api` and `opencode_ai.models`.
The hand-written surface in this module is limited to:

* `Client` / `AuthenticatedClient` — re-exported from the generated `client`
  module so callers can do `from opencode_ai import Client`.
* `ServerOptions`, `ServerHandle`, `AsyncServerHandle`,
  `create_opencode_server` — process helpers that mirror
  `createOpencodeServer` in the JS SDK.

Operation modules are reached as `from opencode_ai.api.default import session_create`,
matching the openapi-python-client convention. Each operation module exposes
`sync`, `sync_detailed`, `asyncio`, and `asyncio_detailed` functions.
"""

from .client import AuthenticatedClient, Client
from .server import (
    AsyncServerHandle,
    ServerHandle,
    ServerOptions,
    create_opencode_server,
)

__all__ = (
    "AsyncServerHandle",
    "AuthenticatedClient",
    "Client",
    "ServerHandle",
    "ServerOptions",
    "create_opencode_server",
)
