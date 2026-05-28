from http import HTTPStatus
from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.bad_request_error import BadRequestError
from ...models.pty_connect_token_response_200 import PtyConnectTokenResponse200
from ...models.pty_forbidden_error import PtyForbiddenError
from ...models.pty_not_found_error import PtyNotFoundError
from ...types import UNSET, Response, Unset


def _get_kwargs(
    pty_id: str,
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
        "url": "/pty/{pty_id}/connect-token".format(
            pty_id=quote(str(pty_id), safe=""),
        ),
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> BadRequestError | PtyConnectTokenResponse200 | PtyForbiddenError | PtyNotFoundError | None:
    if response.status_code == 200:
        response_200 = PtyConnectTokenResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = BadRequestError.from_dict(response.json())

        return response_400

    if response.status_code == 403:
        response_403 = PtyForbiddenError.from_dict(response.json())

        return response_403

    if response.status_code == 404:
        response_404 = PtyNotFoundError.from_dict(response.json())

        return response_404

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[BadRequestError | PtyConnectTokenResponse200 | PtyForbiddenError | PtyNotFoundError]:
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
) -> Response[BadRequestError | PtyConnectTokenResponse200 | PtyForbiddenError | PtyNotFoundError]:
    """Create PTY WebSocket token

     Create a short-lived ticket for opening a PTY WebSocket connection.

    Args:
        pty_id (str):
        directory (str | Unset):
        workspace (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[BadRequestError | PtyConnectTokenResponse200 | PtyForbiddenError | PtyNotFoundError]
    """

    kwargs = _get_kwargs(
        pty_id=pty_id,
        directory=directory,
        workspace=workspace,
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
) -> BadRequestError | PtyConnectTokenResponse200 | PtyForbiddenError | PtyNotFoundError | None:
    """Create PTY WebSocket token

     Create a short-lived ticket for opening a PTY WebSocket connection.

    Args:
        pty_id (str):
        directory (str | Unset):
        workspace (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        BadRequestError | PtyConnectTokenResponse200 | PtyForbiddenError | PtyNotFoundError
    """

    return sync_detailed(
        pty_id=pty_id,
        client=client,
        directory=directory,
        workspace=workspace,
    ).parsed


async def asyncio_detailed(
    pty_id: str,
    *,
    client: AuthenticatedClient | Client,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
) -> Response[BadRequestError | PtyConnectTokenResponse200 | PtyForbiddenError | PtyNotFoundError]:
    """Create PTY WebSocket token

     Create a short-lived ticket for opening a PTY WebSocket connection.

    Args:
        pty_id (str):
        directory (str | Unset):
        workspace (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[BadRequestError | PtyConnectTokenResponse200 | PtyForbiddenError | PtyNotFoundError]
    """

    kwargs = _get_kwargs(
        pty_id=pty_id,
        directory=directory,
        workspace=workspace,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    pty_id: str,
    *,
    client: AuthenticatedClient | Client,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
) -> BadRequestError | PtyConnectTokenResponse200 | PtyForbiddenError | PtyNotFoundError | None:
    """Create PTY WebSocket token

     Create a short-lived ticket for opening a PTY WebSocket connection.

    Args:
        pty_id (str):
        directory (str | Unset):
        workspace (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        BadRequestError | PtyConnectTokenResponse200 | PtyForbiddenError | PtyNotFoundError
    """

    return (
        await asyncio_detailed(
            pty_id=pty_id,
            client=client,
            directory=directory,
            workspace=workspace,
        )
    ).parsed
