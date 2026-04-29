from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.mcp_auth_start_response_200 import McpAuthStartResponse200
from ...models.mcp_unsupported_o_auth_error import McpUnsupportedOAuthError
from ...models.not_found_error import NotFoundError
from ...types import UNSET, Response, Unset


def _get_kwargs(
    name: str,
    *,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["directory"] = directory

    params["workspace"] = workspace

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/mcp/{name}/auth".format(
            name=quote(str(name), safe=""),
        ),
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> McpAuthStartResponse200 | McpUnsupportedOAuthError | NotFoundError | None:
    if response.status_code == 200:
        response_200 = McpAuthStartResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = McpUnsupportedOAuthError.from_dict(response.json())

        return response_400

    if response.status_code == 404:
        response_404 = NotFoundError.from_dict(response.json())

        return response_404

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[McpAuthStartResponse200 | McpUnsupportedOAuthError | NotFoundError]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    name: str,
    *,
    client: AuthenticatedClient | Client,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
) -> Response[McpAuthStartResponse200 | McpUnsupportedOAuthError | NotFoundError]:
    """Start MCP OAuth

     Start OAuth authentication flow for a Model Context Protocol (MCP) server.

    Args:
        name (str):
        directory (str | Unset):
        workspace (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[McpAuthStartResponse200 | McpUnsupportedOAuthError | NotFoundError]
    """

    kwargs = _get_kwargs(
        name=name,
        directory=directory,
        workspace=workspace,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    name: str,
    *,
    client: AuthenticatedClient | Client,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
) -> McpAuthStartResponse200 | McpUnsupportedOAuthError | NotFoundError | None:
    """Start MCP OAuth

     Start OAuth authentication flow for a Model Context Protocol (MCP) server.

    Args:
        name (str):
        directory (str | Unset):
        workspace (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        McpAuthStartResponse200 | McpUnsupportedOAuthError | NotFoundError
    """

    return sync_detailed(
        name=name,
        client=client,
        directory=directory,
        workspace=workspace,
    ).parsed


async def asyncio_detailed(
    name: str,
    *,
    client: AuthenticatedClient | Client,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
) -> Response[McpAuthStartResponse200 | McpUnsupportedOAuthError | NotFoundError]:
    """Start MCP OAuth

     Start OAuth authentication flow for a Model Context Protocol (MCP) server.

    Args:
        name (str):
        directory (str | Unset):
        workspace (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[McpAuthStartResponse200 | McpUnsupportedOAuthError | NotFoundError]
    """

    kwargs = _get_kwargs(
        name=name,
        directory=directory,
        workspace=workspace,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    name: str,
    *,
    client: AuthenticatedClient | Client,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
) -> McpAuthStartResponse200 | McpUnsupportedOAuthError | NotFoundError | None:
    """Start MCP OAuth

     Start OAuth authentication flow for a Model Context Protocol (MCP) server.

    Args:
        name (str):
        directory (str | Unset):
        workspace (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        McpAuthStartResponse200 | McpUnsupportedOAuthError | NotFoundError
    """

    return (
        await asyncio_detailed(
            name=name,
            client=client,
            directory=directory,
            workspace=workspace,
        )
    ).parsed
