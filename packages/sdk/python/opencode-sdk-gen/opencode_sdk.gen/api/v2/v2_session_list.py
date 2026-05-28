from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.invalid_cursor_error import InvalidCursorError
from ...models.invalid_request_error import InvalidRequestError
from ...models.unauthorized_error import UnauthorizedError
from ...models.v2_session_list_order import V2SessionListOrder
from ...models.v2_session_list_roots_type_1 import V2SessionListRootsType1
from ...models.v2_sessions_response import V2SessionsResponse
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
    limit: float | Unset = UNSET,
    order: V2SessionListOrder | Unset = UNSET,
    path: str | Unset = UNSET,
    roots: bool | Unset | V2SessionListRootsType1 = UNSET,
    start: float | Unset = UNSET,
    search: str | Unset = UNSET,
    cursor: str | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["directory"] = directory

    params["workspace"] = workspace

    params["limit"] = limit

    json_order: str | Unset = UNSET
    if not isinstance(order, Unset):
        json_order = order.value

    params["order"] = json_order

    params["path"] = path

    json_roots: bool | str | Unset
    if isinstance(roots, Unset):
        json_roots = UNSET
    elif isinstance(roots, V2SessionListRootsType1):
        json_roots = roots.value
    else:
        json_roots = roots
    params["roots"] = json_roots

    params["start"] = start

    params["search"] = search

    params["cursor"] = cursor

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/session",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> InvalidCursorError | InvalidRequestError | UnauthorizedError | V2SessionsResponse | None:
    if response.status_code == 200:
        response_200 = V2SessionsResponse.from_dict(response.json())

        return response_200

    if response.status_code == 400:

        def _parse_response_400(data: object) -> InvalidCursorError | InvalidRequestError:
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                response_400_type_0 = InvalidCursorError.from_dict(data)

                return response_400_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            response_400_type_1 = InvalidRequestError.from_dict(data)

            return response_400_type_1

        response_400 = _parse_response_400(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = UnauthorizedError.from_dict(response.json())

        return response_401

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[InvalidCursorError | InvalidRequestError | UnauthorizedError | V2SessionsResponse]:
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
    limit: float | Unset = UNSET,
    order: V2SessionListOrder | Unset = UNSET,
    path: str | Unset = UNSET,
    roots: bool | Unset | V2SessionListRootsType1 = UNSET,
    start: float | Unset = UNSET,
    search: str | Unset = UNSET,
    cursor: str | Unset = UNSET,
) -> Response[InvalidCursorError | InvalidRequestError | UnauthorizedError | V2SessionsResponse]:
    """List v2 sessions

     Retrieve sessions in the requested order. Items keep that order across pages; use cursor.next or
    cursor.previous to move through the ordered list.

    Args:
        directory (str | Unset):
        workspace (str | Unset):
        limit (float | Unset):
        order (V2SessionListOrder | Unset):
        path (str | Unset):
        roots (bool | Unset | V2SessionListRootsType1):
        start (float | Unset):
        search (str | Unset):
        cursor (str | Unset): Opaque pagination cursor returned as cursor.previous or cursor.next
            in the previous response. Do not combine with order or filters.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[InvalidCursorError | InvalidRequestError | UnauthorizedError | V2SessionsResponse]
    """

    kwargs = _get_kwargs(
        directory=directory,
        workspace=workspace,
        limit=limit,
        order=order,
        path=path,
        roots=roots,
        start=start,
        search=search,
        cursor=cursor,
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
    limit: float | Unset = UNSET,
    order: V2SessionListOrder | Unset = UNSET,
    path: str | Unset = UNSET,
    roots: bool | Unset | V2SessionListRootsType1 = UNSET,
    start: float | Unset = UNSET,
    search: str | Unset = UNSET,
    cursor: str | Unset = UNSET,
) -> InvalidCursorError | InvalidRequestError | UnauthorizedError | V2SessionsResponse | None:
    """List v2 sessions

     Retrieve sessions in the requested order. Items keep that order across pages; use cursor.next or
    cursor.previous to move through the ordered list.

    Args:
        directory (str | Unset):
        workspace (str | Unset):
        limit (float | Unset):
        order (V2SessionListOrder | Unset):
        path (str | Unset):
        roots (bool | Unset | V2SessionListRootsType1):
        start (float | Unset):
        search (str | Unset):
        cursor (str | Unset): Opaque pagination cursor returned as cursor.previous or cursor.next
            in the previous response. Do not combine with order or filters.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        InvalidCursorError | InvalidRequestError | UnauthorizedError | V2SessionsResponse
    """

    return sync_detailed(
        client=client,
        directory=directory,
        workspace=workspace,
        limit=limit,
        order=order,
        path=path,
        roots=roots,
        start=start,
        search=search,
        cursor=cursor,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
    limit: float | Unset = UNSET,
    order: V2SessionListOrder | Unset = UNSET,
    path: str | Unset = UNSET,
    roots: bool | Unset | V2SessionListRootsType1 = UNSET,
    start: float | Unset = UNSET,
    search: str | Unset = UNSET,
    cursor: str | Unset = UNSET,
) -> Response[InvalidCursorError | InvalidRequestError | UnauthorizedError | V2SessionsResponse]:
    """List v2 sessions

     Retrieve sessions in the requested order. Items keep that order across pages; use cursor.next or
    cursor.previous to move through the ordered list.

    Args:
        directory (str | Unset):
        workspace (str | Unset):
        limit (float | Unset):
        order (V2SessionListOrder | Unset):
        path (str | Unset):
        roots (bool | Unset | V2SessionListRootsType1):
        start (float | Unset):
        search (str | Unset):
        cursor (str | Unset): Opaque pagination cursor returned as cursor.previous or cursor.next
            in the previous response. Do not combine with order or filters.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[InvalidCursorError | InvalidRequestError | UnauthorizedError | V2SessionsResponse]
    """

    kwargs = _get_kwargs(
        directory=directory,
        workspace=workspace,
        limit=limit,
        order=order,
        path=path,
        roots=roots,
        start=start,
        search=search,
        cursor=cursor,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
    limit: float | Unset = UNSET,
    order: V2SessionListOrder | Unset = UNSET,
    path: str | Unset = UNSET,
    roots: bool | Unset | V2SessionListRootsType1 = UNSET,
    start: float | Unset = UNSET,
    search: str | Unset = UNSET,
    cursor: str | Unset = UNSET,
) -> InvalidCursorError | InvalidRequestError | UnauthorizedError | V2SessionsResponse | None:
    """List v2 sessions

     Retrieve sessions in the requested order. Items keep that order across pages; use cursor.next or
    cursor.previous to move through the ordered list.

    Args:
        directory (str | Unset):
        workspace (str | Unset):
        limit (float | Unset):
        order (V2SessionListOrder | Unset):
        path (str | Unset):
        roots (bool | Unset | V2SessionListRootsType1):
        start (float | Unset):
        search (str | Unset):
        cursor (str | Unset): Opaque pagination cursor returned as cursor.previous or cursor.next
            in the previous response. Do not combine with order or filters.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        InvalidCursorError | InvalidRequestError | UnauthorizedError | V2SessionsResponse
    """

    return (
        await asyncio_detailed(
            client=client,
            directory=directory,
            workspace=workspace,
            limit=limit,
            order=order,
            path=path,
            roots=roots,
            start=start,
            search=search,
            cursor=cursor,
        )
    ).parsed
