from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.bad_request_error import BadRequestError
from ...models.mcp_server_not_found_error import McpServerNotFoundError
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
        "url": "/mcp/{name}/disconnect".format(
            name=quote(str(name), safe=""),
        ),
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> BadRequestError | McpServerNotFoundError | bool | None:
    if response.status_code == 200:
        response_200 = cast(bool, response.json())
        return response_200

    if response.status_code == 400:
        response_400 = BadRequestError.from_dict(response.json())

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
) -> Response[BadRequestError | McpServerNotFoundError | bool]:
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
) -> Response[BadRequestError | McpServerNotFoundError | bool]:
    """Disconnect an MCP server.

    Args:
        name (str):
        directory (str | Unset):
        workspace (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[BadRequestError | McpServerNotFoundError | bool]
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
) -> BadRequestError | McpServerNotFoundError | bool | None:
    """Disconnect an MCP server.

    Args:
        name (str):
        directory (str | Unset):
        workspace (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        BadRequestError | McpServerNotFoundError | bool
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
) -> Response[BadRequestError | McpServerNotFoundError | bool]:
    """Disconnect an MCP server.

    Args:
        name (str):
        directory (str | Unset):
        workspace (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[BadRequestError | McpServerNotFoundError | bool]
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
) -> BadRequestError | McpServerNotFoundError | bool | None:
    """Disconnect an MCP server.

    Args:
        name (str):
        directory (str | Unset):
        workspace (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        BadRequestError | McpServerNotFoundError | bool
    """

    return (
        await asyncio_detailed(
            name=name,
            client=client,
            directory=directory,
            workspace=workspace,
        )
    ).parsed
