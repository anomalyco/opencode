from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.effect_http_api_error_forbidden import EffectHttpApiErrorForbidden
from ...models.not_found_error import NotFoundError
from ...types import UNSET, Response, Unset


def _get_kwargs(
    pty_id: str,
    *,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
    cursor: str | Unset = UNSET,
    ticket: str | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["directory"] = directory

    params["workspace"] = workspace

    params["cursor"] = cursor

    params["ticket"] = ticket

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/pty/{pty_id}/connect".format(
            pty_id=quote(str(pty_id), safe=""),
        ),
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> EffectHttpApiErrorForbidden | NotFoundError | bool | None:
    if response.status_code == 200:
        response_200 = cast(bool, response.json())
        return response_200

    if response.status_code == 403:
        response_403 = EffectHttpApiErrorForbidden.from_dict(response.json())

        return response_403

    if response.status_code == 404:
        response_404 = NotFoundError.from_dict(response.json())

        return response_404

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[EffectHttpApiErrorForbidden | NotFoundError | bool]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    pty_id: str,
    *,
    client: AuthenticatedClient | Client,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
    cursor: str | Unset = UNSET,
    ticket: str | Unset = UNSET,
) -> Response[EffectHttpApiErrorForbidden | NotFoundError | bool]:
    """Connect to PTY session

     Establish a WebSocket connection to interact with a pseudo-terminal (PTY) session in real-time.

    Args:
        pty_id (str):
        directory (str | Unset):
        workspace (str | Unset):
        cursor (str | Unset):
        ticket (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[EffectHttpApiErrorForbidden | NotFoundError | bool]
    """

    kwargs = _get_kwargs(
        pty_id=pty_id,
        directory=directory,
        workspace=workspace,
        cursor=cursor,
        ticket=ticket,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    pty_id: str,
    *,
    client: AuthenticatedClient | Client,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
    cursor: str | Unset = UNSET,
    ticket: str | Unset = UNSET,
) -> EffectHttpApiErrorForbidden | NotFoundError | bool | None:
    """Connect to PTY session

     Establish a WebSocket connection to interact with a pseudo-terminal (PTY) session in real-time.

    Args:
        pty_id (str):
        directory (str | Unset):
        workspace (str | Unset):
        cursor (str | Unset):
        ticket (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        EffectHttpApiErrorForbidden | NotFoundError | bool
    """

    return sync_detailed(
        pty_id=pty_id,
        client=client,
        directory=directory,
        workspace=workspace,
        cursor=cursor,
        ticket=ticket,
    ).parsed


async def asyncio_detailed(
    pty_id: str,
    *,
    client: AuthenticatedClient | Client,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
    cursor: str | Unset = UNSET,
    ticket: str | Unset = UNSET,
) -> Response[EffectHttpApiErrorForbidden | NotFoundError | bool]:
    """Connect to PTY session

     Establish a WebSocket connection to interact with a pseudo-terminal (PTY) session in real-time.

    Args:
        pty_id (str):
        directory (str | Unset):
        workspace (str | Unset):
        cursor (str | Unset):
        ticket (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[EffectHttpApiErrorForbidden | NotFoundError | bool]
    """

    kwargs = _get_kwargs(
        pty_id=pty_id,
        directory=directory,
        workspace=workspace,
        cursor=cursor,
        ticket=ticket,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    pty_id: str,
    *,
    client: AuthenticatedClient | Client,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
    cursor: str | Unset = UNSET,
    ticket: str | Unset = UNSET,
) -> EffectHttpApiErrorForbidden | NotFoundError | bool | None:
    """Connect to PTY session

     Establish a WebSocket connection to interact with a pseudo-terminal (PTY) session in real-time.

    Args:
        pty_id (str):
        directory (str | Unset):
        workspace (str | Unset):
        cursor (str | Unset):
        ticket (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        EffectHttpApiErrorForbidden | NotFoundError | bool
    """

    return (
        await asyncio_detailed(
            pty_id=pty_id,
            client=client,
            directory=directory,
            workspace=workspace,
            cursor=cursor,
            ticket=ticket,
        )
    ).parsed
