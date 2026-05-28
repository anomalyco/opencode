from http import HTTPStatus
from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.invalid_request_error import InvalidRequestError
from ...models.mcp_auth_start_response_200 import McpAuthStartResponse200
from ...models.mcp_server_not_found_error import McpServerNotFoundError
from ...models.mcp_unsupported_o_auth_error import McpUnsupportedOAuthError
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
) -> InvalidRequestError | McpUnsupportedOAuthError | McpAuthStartResponse200 | McpServerNotFoundError | None:
    if response.status_code == 200:
        response_200 = McpAuthStartResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:

        def _parse_response_400(data: object) -> InvalidRequestError | McpUnsupportedOAuthError:
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                response_400_type_0 = McpUnsupportedOAuthError.from_dict(data)

                return response_400_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            response_400_type_1 = InvalidRequestError.from_dict(data)

            return response_400_type_1

        response_400 = _parse_response_400(response.json())

        return response_400

    if response.status_code == 404:
        response_404 = McpServerNotFoundError.from_dict(response.json())

        return response_404

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[InvalidRequestError | McpUnsupportedOAuthError | McpAuthStartResponse200 | McpServerNotFoundError]:
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
) -> Response[InvalidRequestError | McpUnsupportedOAuthError | McpAuthStartResponse200 | McpServerNotFoundError]:
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
        Response[InvalidRequestError | McpUnsupportedOAuthError | McpAuthStartResponse200 | McpServerNotFoundError]
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
) -> InvalidRequestError | McpUnsupportedOAuthError | McpAuthStartResponse200 | McpServerNotFoundError | None:
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
        InvalidRequestError | McpUnsupportedOAuthError | McpAuthStartResponse200 | McpServerNotFoundError
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
) -> Response[InvalidRequestError | McpUnsupportedOAuthError | McpAuthStartResponse200 | McpServerNotFoundError]:
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
        Response[InvalidRequestError | McpUnsupportedOAuthError | McpAuthStartResponse200 | McpServerNotFoundError]
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
) -> InvalidRequestError | McpUnsupportedOAuthError | McpAuthStartResponse200 | McpServerNotFoundError | None:
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
        InvalidRequestError | McpUnsupportedOAuthError | McpAuthStartResponse200 | McpServerNotFoundError
    """

    return (
        await asyncio_detailed(
            name=name,
            client=client,
            directory=directory,
            workspace=workspace,
        )
    ).parsed
