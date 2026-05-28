from http import HTTPStatus
from typing import Any, cast

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.bad_request_error import BadRequestError
from ...models.find_files_dirs import FindFilesDirs
from ...models.find_files_type import FindFilesType
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
    query: str,
    dirs: FindFilesDirs | Unset = UNSET,
    type_: FindFilesType | Unset = UNSET,
    limit: int | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["directory"] = directory

    params["workspace"] = workspace

    params["query"] = query

    json_dirs: str | Unset = UNSET
    if not isinstance(dirs, Unset):
        json_dirs = dirs.value

    params["dirs"] = json_dirs

    json_type_: str | Unset = UNSET
    if not isinstance(type_, Unset):
        json_type_ = type_.value

    params["type"] = json_type_

    params["limit"] = limit

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/find/file",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> BadRequestError | list[str] | None:
    if response.status_code == 200:
        response_200 = cast(list[str], response.json())

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
) -> Response[BadRequestError | list[str]]:
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
    query: str,
    dirs: FindFilesDirs | Unset = UNSET,
    type_: FindFilesType | Unset = UNSET,
    limit: int | Unset = UNSET,
) -> Response[BadRequestError | list[str]]:
    """Find files

     Search for files or directories by name or pattern in the project directory.

    Args:
        directory (str | Unset):
        workspace (str | Unset):
        query (str):
        dirs (FindFilesDirs | Unset):
        type_ (FindFilesType | Unset):
        limit (int | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[BadRequestError | list[str]]
    """

    kwargs = _get_kwargs(
        directory=directory,
        workspace=workspace,
        query=query,
        dirs=dirs,
        type_=type_,
        limit=limit,
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
    query: str,
    dirs: FindFilesDirs | Unset = UNSET,
    type_: FindFilesType | Unset = UNSET,
    limit: int | Unset = UNSET,
) -> BadRequestError | list[str] | None:
    """Find files

     Search for files or directories by name or pattern in the project directory.

    Args:
        directory (str | Unset):
        workspace (str | Unset):
        query (str):
        dirs (FindFilesDirs | Unset):
        type_ (FindFilesType | Unset):
        limit (int | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        BadRequestError | list[str]
    """

    return sync_detailed(
        client=client,
        directory=directory,
        workspace=workspace,
        query=query,
        dirs=dirs,
        type_=type_,
        limit=limit,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
    query: str,
    dirs: FindFilesDirs | Unset = UNSET,
    type_: FindFilesType | Unset = UNSET,
    limit: int | Unset = UNSET,
) -> Response[BadRequestError | list[str]]:
    """Find files

     Search for files or directories by name or pattern in the project directory.

    Args:
        directory (str | Unset):
        workspace (str | Unset):
        query (str):
        dirs (FindFilesDirs | Unset):
        type_ (FindFilesType | Unset):
        limit (int | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[BadRequestError | list[str]]
    """

    kwargs = _get_kwargs(
        directory=directory,
        workspace=workspace,
        query=query,
        dirs=dirs,
        type_=type_,
        limit=limit,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
    query: str,
    dirs: FindFilesDirs | Unset = UNSET,
    type_: FindFilesType | Unset = UNSET,
    limit: int | Unset = UNSET,
) -> BadRequestError | list[str] | None:
    """Find files

     Search for files or directories by name or pattern in the project directory.

    Args:
        directory (str | Unset):
        workspace (str | Unset):
        query (str):
        dirs (FindFilesDirs | Unset):
        type_ (FindFilesType | Unset):
        limit (int | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        BadRequestError | list[str]
    """

    return (
        await asyncio_detailed(
            client=client,
            directory=directory,
            workspace=workspace,
            query=query,
            dirs=dirs,
            type_=type_,
            limit=limit,
        )
    ).parsed
