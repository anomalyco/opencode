from http import HTTPStatus
from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.effect_http_api_error_bad_request import EffectHttpApiErrorBadRequest
from ...models.invalid_request_error import InvalidRequestError
from ...models.not_found_error import NotFoundError
from ...models.session_messages_response_200_item import SessionMessagesResponse200Item
from ...types import UNSET, Response, Unset


def _get_kwargs(
    session_id: str,
    *,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
    limit: int | Unset = UNSET,
    before: str | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["directory"] = directory

    params["workspace"] = workspace

    params["limit"] = limit

    params["before"] = before

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/session/{session_id}/message".format(
            session_id=quote(str(session_id), safe=""),
        ),
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> EffectHttpApiErrorBadRequest | InvalidRequestError | NotFoundError | list[SessionMessagesResponse200Item] | None:
    if response.status_code == 200:
        response_200 = []
        _response_200 = response.json()
        for response_200_item_data in _response_200:
            response_200_item = SessionMessagesResponse200Item.from_dict(response_200_item_data)

            response_200.append(response_200_item)

        return response_200

    if response.status_code == 400:

        def _parse_response_400(data: object) -> EffectHttpApiErrorBadRequest | InvalidRequestError:
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                response_400_type_0 = EffectHttpApiErrorBadRequest.from_dict(data)

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
        response_404 = NotFoundError.from_dict(response.json())

        return response_404

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    EffectHttpApiErrorBadRequest | InvalidRequestError | NotFoundError | list[SessionMessagesResponse200Item]
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
    limit: int | Unset = UNSET,
    before: str | Unset = UNSET,
) -> Response[
    EffectHttpApiErrorBadRequest | InvalidRequestError | NotFoundError | list[SessionMessagesResponse200Item]
]:
    """Get session messages

     Retrieve all messages in a session, including user prompts and AI responses.

    Args:
        session_id (str):
        directory (str | Unset):
        workspace (str | Unset):
        limit (int | Unset):
        before (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[EffectHttpApiErrorBadRequest | InvalidRequestError | NotFoundError | list[SessionMessagesResponse200Item]]
    """

    kwargs = _get_kwargs(
        session_id=session_id,
        directory=directory,
        workspace=workspace,
        limit=limit,
        before=before,
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
    limit: int | Unset = UNSET,
    before: str | Unset = UNSET,
) -> EffectHttpApiErrorBadRequest | InvalidRequestError | NotFoundError | list[SessionMessagesResponse200Item] | None:
    """Get session messages

     Retrieve all messages in a session, including user prompts and AI responses.

    Args:
        session_id (str):
        directory (str | Unset):
        workspace (str | Unset):
        limit (int | Unset):
        before (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        EffectHttpApiErrorBadRequest | InvalidRequestError | NotFoundError | list[SessionMessagesResponse200Item]
    """

    return sync_detailed(
        session_id=session_id,
        client=client,
        directory=directory,
        workspace=workspace,
        limit=limit,
        before=before,
    ).parsed


async def asyncio_detailed(
    session_id: str,
    *,
    client: AuthenticatedClient | Client,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
    limit: int | Unset = UNSET,
    before: str | Unset = UNSET,
) -> Response[
    EffectHttpApiErrorBadRequest | InvalidRequestError | NotFoundError | list[SessionMessagesResponse200Item]
]:
    """Get session messages

     Retrieve all messages in a session, including user prompts and AI responses.

    Args:
        session_id (str):
        directory (str | Unset):
        workspace (str | Unset):
        limit (int | Unset):
        before (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[EffectHttpApiErrorBadRequest | InvalidRequestError | NotFoundError | list[SessionMessagesResponse200Item]]
    """

    kwargs = _get_kwargs(
        session_id=session_id,
        directory=directory,
        workspace=workspace,
        limit=limit,
        before=before,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    session_id: str,
    *,
    client: AuthenticatedClient | Client,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
    limit: int | Unset = UNSET,
    before: str | Unset = UNSET,
) -> EffectHttpApiErrorBadRequest | InvalidRequestError | NotFoundError | list[SessionMessagesResponse200Item] | None:
    """Get session messages

     Retrieve all messages in a session, including user prompts and AI responses.

    Args:
        session_id (str):
        directory (str | Unset):
        workspace (str | Unset):
        limit (int | Unset):
        before (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        EffectHttpApiErrorBadRequest | InvalidRequestError | NotFoundError | list[SessionMessagesResponse200Item]
    """

    return (
        await asyncio_detailed(
            session_id=session_id,
            client=client,
            directory=directory,
            workspace=workspace,
            limit=limit,
            before=before,
        )
    ).parsed
