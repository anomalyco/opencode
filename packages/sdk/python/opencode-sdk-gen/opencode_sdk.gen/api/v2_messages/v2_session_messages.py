from http import HTTPStatus
from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.invalid_cursor_error import InvalidCursorError
from ...models.invalid_request_error import InvalidRequestError
from ...models.session_not_found_error import SessionNotFoundError
from ...models.unauthorized_error import UnauthorizedError
from ...models.unknown_error_1 import UnknownError1
from ...models.v2_session_messages_order import V2SessionMessagesOrder
from ...models.v2_session_messages_response import V2SessionMessagesResponse
from ...types import UNSET, Response, Unset


def _get_kwargs(
    session_id: str,
    *,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
    limit: float | Unset = UNSET,
    order: V2SessionMessagesOrder | Unset = UNSET,
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

    params["cursor"] = cursor

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/session/{session_id}/message".format(
            session_id=quote(str(session_id), safe=""),
        ),
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    InvalidCursorError
    | InvalidRequestError
    | SessionNotFoundError
    | UnauthorizedError
    | UnknownError1
    | V2SessionMessagesResponse
    | None
):
    if response.status_code == 200:
        response_200 = V2SessionMessagesResponse.from_dict(response.json())

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

    if response.status_code == 404:
        response_404 = SessionNotFoundError.from_dict(response.json())

        return response_404

    if response.status_code == 500:
        response_500 = UnknownError1.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    InvalidCursorError
    | InvalidRequestError
    | SessionNotFoundError
    | UnauthorizedError
    | UnknownError1
    | V2SessionMessagesResponse
]:
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
    limit: float | Unset = UNSET,
    order: V2SessionMessagesOrder | Unset = UNSET,
    cursor: str | Unset = UNSET,
) -> Response[
    InvalidCursorError
    | InvalidRequestError
    | SessionNotFoundError
    | UnauthorizedError
    | UnknownError1
    | V2SessionMessagesResponse
]:
    """Get v2 session messages

     Retrieve projected v2 messages for a session. Items keep the requested order across pages; use
    cursor.next or cursor.previous to move through the ordered timeline.

    Args:
        session_id (str):
        directory (str | Unset):
        workspace (str | Unset):
        limit (float | Unset):
        order (V2SessionMessagesOrder | Unset):
        cursor (str | Unset): Opaque pagination cursor returned as cursor.previous or cursor.next
            in the previous response. Do not combine with order.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[InvalidCursorError | InvalidRequestError | SessionNotFoundError | UnauthorizedError | UnknownError1 | V2SessionMessagesResponse]
    """

    kwargs = _get_kwargs(
        session_id=session_id,
        directory=directory,
        workspace=workspace,
        limit=limit,
        order=order,
        cursor=cursor,
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
    limit: float | Unset = UNSET,
    order: V2SessionMessagesOrder | Unset = UNSET,
    cursor: str | Unset = UNSET,
) -> (
    InvalidCursorError
    | InvalidRequestError
    | SessionNotFoundError
    | UnauthorizedError
    | UnknownError1
    | V2SessionMessagesResponse
    | None
):
    """Get v2 session messages

     Retrieve projected v2 messages for a session. Items keep the requested order across pages; use
    cursor.next or cursor.previous to move through the ordered timeline.

    Args:
        session_id (str):
        directory (str | Unset):
        workspace (str | Unset):
        limit (float | Unset):
        order (V2SessionMessagesOrder | Unset):
        cursor (str | Unset): Opaque pagination cursor returned as cursor.previous or cursor.next
            in the previous response. Do not combine with order.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        InvalidCursorError | InvalidRequestError | SessionNotFoundError | UnauthorizedError | UnknownError1 | V2SessionMessagesResponse
    """

    return sync_detailed(
        session_id=session_id,
        client=client,
        directory=directory,
        workspace=workspace,
        limit=limit,
        order=order,
        cursor=cursor,
    ).parsed


async def asyncio_detailed(
    session_id: str,
    *,
    client: AuthenticatedClient | Client,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
    limit: float | Unset = UNSET,
    order: V2SessionMessagesOrder | Unset = UNSET,
    cursor: str | Unset = UNSET,
) -> Response[
    InvalidCursorError
    | InvalidRequestError
    | SessionNotFoundError
    | UnauthorizedError
    | UnknownError1
    | V2SessionMessagesResponse
]:
    """Get v2 session messages

     Retrieve projected v2 messages for a session. Items keep the requested order across pages; use
    cursor.next or cursor.previous to move through the ordered timeline.

    Args:
        session_id (str):
        directory (str | Unset):
        workspace (str | Unset):
        limit (float | Unset):
        order (V2SessionMessagesOrder | Unset):
        cursor (str | Unset): Opaque pagination cursor returned as cursor.previous or cursor.next
            in the previous response. Do not combine with order.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[InvalidCursorError | InvalidRequestError | SessionNotFoundError | UnauthorizedError | UnknownError1 | V2SessionMessagesResponse]
    """

    kwargs = _get_kwargs(
        session_id=session_id,
        directory=directory,
        workspace=workspace,
        limit=limit,
        order=order,
        cursor=cursor,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    session_id: str,
    *,
    client: AuthenticatedClient | Client,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
    limit: float | Unset = UNSET,
    order: V2SessionMessagesOrder | Unset = UNSET,
    cursor: str | Unset = UNSET,
) -> (
    InvalidCursorError
    | InvalidRequestError
    | SessionNotFoundError
    | UnauthorizedError
    | UnknownError1
    | V2SessionMessagesResponse
    | None
):
    """Get v2 session messages

     Retrieve projected v2 messages for a session. Items keep the requested order across pages; use
    cursor.next or cursor.previous to move through the ordered timeline.

    Args:
        session_id (str):
        directory (str | Unset):
        workspace (str | Unset):
        limit (float | Unset):
        order (V2SessionMessagesOrder | Unset):
        cursor (str | Unset): Opaque pagination cursor returned as cursor.previous or cursor.next
            in the previous response. Do not combine with order.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        InvalidCursorError | InvalidRequestError | SessionNotFoundError | UnauthorizedError | UnknownError1 | V2SessionMessagesResponse
    """

    return (
        await asyncio_detailed(
            session_id=session_id,
            client=client,
            directory=directory,
            workspace=workspace,
            limit=limit,
            order=order,
            cursor=cursor,
        )
    ).parsed
