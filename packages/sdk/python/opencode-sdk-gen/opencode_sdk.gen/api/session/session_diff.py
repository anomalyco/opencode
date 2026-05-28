from http import HTTPStatus
from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.bad_request_error import BadRequestError
from ...models.snapshot_file_diff import SnapshotFileDiff
from ...types import UNSET, Response, Unset


def _get_kwargs(
    session_id: str,
    *,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
    message_id: str | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["directory"] = directory

    params["workspace"] = workspace

    params["messageID"] = message_id

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/session/{session_id}/diff".format(
            session_id=quote(str(session_id), safe=""),
        ),
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> BadRequestError | list[SnapshotFileDiff] | None:
    if response.status_code == 200:
        response_200 = []
        _response_200 = response.json()
        for response_200_item_data in _response_200:
            response_200_item = SnapshotFileDiff.from_dict(response_200_item_data)

            response_200.append(response_200_item)

        return response_200

    if response.status_code == 400:
        response_400 = BadRequestError.from_dict(response.json())

        return response_400

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[BadRequestError | list[SnapshotFileDiff]]:
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
    message_id: str | Unset = UNSET,
) -> Response[BadRequestError | list[SnapshotFileDiff]]:
    """Get message diff

     Get the file changes (diff) that resulted from a specific user message in the session.

    Args:
        session_id (str):
        directory (str | Unset):
        workspace (str | Unset):
        message_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[BadRequestError | list[SnapshotFileDiff]]
    """

    kwargs = _get_kwargs(
        session_id=session_id,
        directory=directory,
        workspace=workspace,
        message_id=message_id,
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
    message_id: str | Unset = UNSET,
) -> BadRequestError | list[SnapshotFileDiff] | None:
    """Get message diff

     Get the file changes (diff) that resulted from a specific user message in the session.

    Args:
        session_id (str):
        directory (str | Unset):
        workspace (str | Unset):
        message_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        BadRequestError | list[SnapshotFileDiff]
    """

    return sync_detailed(
        session_id=session_id,
        client=client,
        directory=directory,
        workspace=workspace,
        message_id=message_id,
    ).parsed


async def asyncio_detailed(
    session_id: str,
    *,
    client: AuthenticatedClient | Client,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
    message_id: str | Unset = UNSET,
) -> Response[BadRequestError | list[SnapshotFileDiff]]:
    """Get message diff

     Get the file changes (diff) that resulted from a specific user message in the session.

    Args:
        session_id (str):
        directory (str | Unset):
        workspace (str | Unset):
        message_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[BadRequestError | list[SnapshotFileDiff]]
    """

    kwargs = _get_kwargs(
        session_id=session_id,
        directory=directory,
        workspace=workspace,
        message_id=message_id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    session_id: str,
    *,
    client: AuthenticatedClient | Client,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
    message_id: str | Unset = UNSET,
) -> BadRequestError | list[SnapshotFileDiff] | None:
    """Get message diff

     Get the file changes (diff) that resulted from a specific user message in the session.

    Args:
        session_id (str):
        directory (str | Unset):
        workspace (str | Unset):
        message_id (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        BadRequestError | list[SnapshotFileDiff]
    """

    return (
        await asyncio_detailed(
            session_id=session_id,
            client=client,
            directory=directory,
            workspace=workspace,
            message_id=message_id,
        )
    ).parsed
