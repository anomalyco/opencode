from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.bad_request_error import BadRequestError
from ...models.experimental_session_list_archived_type_1 import ExperimentalSessionListArchivedType1
from ...models.experimental_session_list_roots_type_1 import ExperimentalSessionListRootsType1
from ...models.global_session import GlobalSession
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
    roots: bool | ExperimentalSessionListRootsType1 | Unset = UNSET,
    start: float | Unset = UNSET,
    cursor: float | Unset = UNSET,
    search: str | Unset = UNSET,
    limit: float | Unset = UNSET,
    archived: bool | ExperimentalSessionListArchivedType1 | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["directory"] = directory

    params["workspace"] = workspace

    json_roots: bool | str | Unset
    if isinstance(roots, Unset):
        json_roots = UNSET
    elif isinstance(roots, ExperimentalSessionListRootsType1):
        json_roots = roots.value
    else:
        json_roots = roots
    params["roots"] = json_roots

    params["start"] = start

    params["cursor"] = cursor

    params["search"] = search

    params["limit"] = limit

    json_archived: bool | str | Unset
    if isinstance(archived, Unset):
        json_archived = UNSET
    elif isinstance(archived, ExperimentalSessionListArchivedType1):
        json_archived = archived.value
    else:
        json_archived = archived
    params["archived"] = json_archived

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/experimental/session",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> BadRequestError | list[GlobalSession] | None:
    if response.status_code == 200:
        response_200 = []
        _response_200 = response.json()
        for response_200_item_data in _response_200:
            response_200_item = GlobalSession.from_dict(response_200_item_data)

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
) -> Response[BadRequestError | list[GlobalSession]]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient | Client,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
    roots: bool | ExperimentalSessionListRootsType1 | Unset = UNSET,
    start: float | Unset = UNSET,
    cursor: float | Unset = UNSET,
    search: str | Unset = UNSET,
    limit: float | Unset = UNSET,
    archived: bool | ExperimentalSessionListArchivedType1 | Unset = UNSET,
) -> Response[BadRequestError | list[GlobalSession]]:
    """List sessions

     Get a list of all OpenCode sessions across projects, sorted by most recently updated. Archived
    sessions are excluded by default.

    Args:
        directory (str | Unset):
        workspace (str | Unset):
        roots (bool | ExperimentalSessionListRootsType1 | Unset):
        start (float | Unset):
        cursor (float | Unset):
        search (str | Unset):
        limit (float | Unset):
        archived (bool | ExperimentalSessionListArchivedType1 | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[BadRequestError | list[GlobalSession]]
    """

    kwargs = _get_kwargs(
        directory=directory,
        workspace=workspace,
        roots=roots,
        start=start,
        cursor=cursor,
        search=search,
        limit=limit,
        archived=archived,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient | Client,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
    roots: bool | ExperimentalSessionListRootsType1 | Unset = UNSET,
    start: float | Unset = UNSET,
    cursor: float | Unset = UNSET,
    search: str | Unset = UNSET,
    limit: float | Unset = UNSET,
    archived: bool | ExperimentalSessionListArchivedType1 | Unset = UNSET,
) -> BadRequestError | list[GlobalSession] | None:
    """List sessions

     Get a list of all OpenCode sessions across projects, sorted by most recently updated. Archived
    sessions are excluded by default.

    Args:
        directory (str | Unset):
        workspace (str | Unset):
        roots (bool | ExperimentalSessionListRootsType1 | Unset):
        start (float | Unset):
        cursor (float | Unset):
        search (str | Unset):
        limit (float | Unset):
        archived (bool | ExperimentalSessionListArchivedType1 | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        BadRequestError | list[GlobalSession]
    """

    return sync_detailed(
        client=client,
        directory=directory,
        workspace=workspace,
        roots=roots,
        start=start,
        cursor=cursor,
        search=search,
        limit=limit,
        archived=archived,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
    roots: bool | ExperimentalSessionListRootsType1 | Unset = UNSET,
    start: float | Unset = UNSET,
    cursor: float | Unset = UNSET,
    search: str | Unset = UNSET,
    limit: float | Unset = UNSET,
    archived: bool | ExperimentalSessionListArchivedType1 | Unset = UNSET,
) -> Response[BadRequestError | list[GlobalSession]]:
    """List sessions

     Get a list of all OpenCode sessions across projects, sorted by most recently updated. Archived
    sessions are excluded by default.

    Args:
        directory (str | Unset):
        workspace (str | Unset):
        roots (bool | ExperimentalSessionListRootsType1 | Unset):
        start (float | Unset):
        cursor (float | Unset):
        search (str | Unset):
        limit (float | Unset):
        archived (bool | ExperimentalSessionListArchivedType1 | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[BadRequestError | list[GlobalSession]]
    """

    kwargs = _get_kwargs(
        directory=directory,
        workspace=workspace,
        roots=roots,
        start=start,
        cursor=cursor,
        search=search,
        limit=limit,
        archived=archived,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
    roots: bool | ExperimentalSessionListRootsType1 | Unset = UNSET,
    start: float | Unset = UNSET,
    cursor: float | Unset = UNSET,
    search: str | Unset = UNSET,
    limit: float | Unset = UNSET,
    archived: bool | ExperimentalSessionListArchivedType1 | Unset = UNSET,
) -> BadRequestError | list[GlobalSession] | None:
    """List sessions

     Get a list of all OpenCode sessions across projects, sorted by most recently updated. Archived
    sessions are excluded by default.

    Args:
        directory (str | Unset):
        workspace (str | Unset):
        roots (bool | ExperimentalSessionListRootsType1 | Unset):
        start (float | Unset):
        cursor (float | Unset):
        search (str | Unset):
        limit (float | Unset):
        archived (bool | ExperimentalSessionListArchivedType1 | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        BadRequestError | list[GlobalSession]
    """

    return (
        await asyncio_detailed(
            client=client,
            directory=directory,
            workspace=workspace,
            roots=roots,
            start=start,
            cursor=cursor,
            search=search,
            limit=limit,
            archived=archived,
        )
    ).parsed
