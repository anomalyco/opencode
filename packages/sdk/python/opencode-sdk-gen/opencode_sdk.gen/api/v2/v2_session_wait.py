from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.invalid_request_error import InvalidRequestError
from ...models.service_unavailable_error import ServiceUnavailableError
from ...models.session_not_found_error import SessionNotFoundError
from ...models.unauthorized_error import UnauthorizedError
from ...types import UNSET, Response, Unset


def _get_kwargs(
    session_id: str,
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
        "url": "/api/session/{session_id}/wait".format(
            session_id=quote(str(session_id), safe=""),
        ),
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Any | InvalidRequestError | ServiceUnavailableError | SessionNotFoundError | UnauthorizedError | None:
    if response.status_code == 204:
        response_204 = cast(Any, None)
        return response_204

    if response.status_code == 400:
        response_400 = InvalidRequestError.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = UnauthorizedError.from_dict(response.json())

        return response_401

    if response.status_code == 404:
        response_404 = SessionNotFoundError.from_dict(response.json())

        return response_404

    if response.status_code == 503:
        response_503 = ServiceUnavailableError.from_dict(response.json())

        return response_503

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[Any | InvalidRequestError | ServiceUnavailableError | SessionNotFoundError | UnauthorizedError]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    session_id: str,
    *,
    client: AuthenticatedClient | Client,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
) -> Response[Any | InvalidRequestError | ServiceUnavailableError | SessionNotFoundError | UnauthorizedError]:
    """Wait for v2 session

     Wait for a v2 session agent loop to become idle.

    Args:
        session_id (str):
        directory (str | Unset):
        workspace (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | InvalidRequestError | ServiceUnavailableError | SessionNotFoundError | UnauthorizedError]
    """

    kwargs = _get_kwargs(
        session_id=session_id,
        directory=directory,
        workspace=workspace,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    session_id: str,
    *,
    client: AuthenticatedClient | Client,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
) -> Any | InvalidRequestError | ServiceUnavailableError | SessionNotFoundError | UnauthorizedError | None:
    """Wait for v2 session

     Wait for a v2 session agent loop to become idle.

    Args:
        session_id (str):
        directory (str | Unset):
        workspace (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | InvalidRequestError | ServiceUnavailableError | SessionNotFoundError | UnauthorizedError
    """

    return sync_detailed(
        session_id=session_id,
        client=client,
        directory=directory,
        workspace=workspace,
    ).parsed


async def asyncio_detailed(
    session_id: str,
    *,
    client: AuthenticatedClient | Client,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
) -> Response[Any | InvalidRequestError | ServiceUnavailableError | SessionNotFoundError | UnauthorizedError]:
    """Wait for v2 session

     Wait for a v2 session agent loop to become idle.

    Args:
        session_id (str):
        directory (str | Unset):
        workspace (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | InvalidRequestError | ServiceUnavailableError | SessionNotFoundError | UnauthorizedError]
    """

    kwargs = _get_kwargs(
        session_id=session_id,
        directory=directory,
        workspace=workspace,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    session_id: str,
    *,
    client: AuthenticatedClient | Client,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
) -> Any | InvalidRequestError | ServiceUnavailableError | SessionNotFoundError | UnauthorizedError | None:
    """Wait for v2 session

     Wait for a v2 session agent loop to become idle.

    Args:
        session_id (str):
        directory (str | Unset):
        workspace (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | InvalidRequestError | ServiceUnavailableError | SessionNotFoundError | UnauthorizedError
    """

    return (
        await asyncio_detailed(
            session_id=session_id,
            client=client,
            directory=directory,
            workspace=workspace,
        )
    ).parsed
