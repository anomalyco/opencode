from http import HTTPStatus
from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.invalid_request_error import InvalidRequestError
from ...models.session_message_agent_switched import SessionMessageAgentSwitched
from ...models.session_message_assistant import SessionMessageAssistant
from ...models.session_message_compaction import SessionMessageCompaction
from ...models.session_message_model_switched import SessionMessageModelSwitched
from ...models.session_message_shell import SessionMessageShell
from ...models.session_message_synthetic import SessionMessageSynthetic
from ...models.session_message_user import SessionMessageUser
from ...models.session_not_found_error import SessionNotFoundError
from ...models.unauthorized_error import UnauthorizedError
from ...models.unknown_error_1 import UnknownError1
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
        "method": "get",
        "url": "/api/session/{session_id}/context".format(
            session_id=quote(str(session_id), safe=""),
        ),
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    InvalidRequestError
    | SessionNotFoundError
    | UnauthorizedError
    | UnknownError1
    | list[
        SessionMessageAgentSwitched
        | SessionMessageAssistant
        | SessionMessageCompaction
        | SessionMessageModelSwitched
        | SessionMessageShell
        | SessionMessageSynthetic
        | SessionMessageUser
    ]
    | None
):
    if response.status_code == 200:
        response_200 = []
        _response_200 = response.json()
        for response_200_item_data in _response_200:

            def _parse_response_200_item(
                data: object,
            ) -> (
                SessionMessageAgentSwitched
                | SessionMessageAssistant
                | SessionMessageCompaction
                | SessionMessageModelSwitched
                | SessionMessageShell
                | SessionMessageSynthetic
                | SessionMessageUser
            ):
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_session_message_type_0 = SessionMessageAgentSwitched.from_dict(data)

                    return componentsschemas_session_message_type_0
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_session_message_type_1 = SessionMessageModelSwitched.from_dict(data)

                    return componentsschemas_session_message_type_1
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_session_message_type_2 = SessionMessageUser.from_dict(data)

                    return componentsschemas_session_message_type_2
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_session_message_type_3 = SessionMessageSynthetic.from_dict(data)

                    return componentsschemas_session_message_type_3
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_session_message_type_4 = SessionMessageShell.from_dict(data)

                    return componentsschemas_session_message_type_4
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_session_message_type_5 = SessionMessageAssistant.from_dict(data)

                    return componentsschemas_session_message_type_5
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_session_message_type_6 = SessionMessageCompaction.from_dict(data)

                return componentsschemas_session_message_type_6

            response_200_item = _parse_response_200_item(response_200_item_data)

            response_200.append(response_200_item)

        return response_200

    if response.status_code == 400:
        response_400 = InvalidRequestError.from_dict(response.json())

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
    InvalidRequestError
    | SessionNotFoundError
    | UnauthorizedError
    | UnknownError1
    | list[
        SessionMessageAgentSwitched
        | SessionMessageAssistant
        | SessionMessageCompaction
        | SessionMessageModelSwitched
        | SessionMessageShell
        | SessionMessageSynthetic
        | SessionMessageUser
    ]
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
) -> Response[
    InvalidRequestError
    | SessionNotFoundError
    | UnauthorizedError
    | UnknownError1
    | list[
        SessionMessageAgentSwitched
        | SessionMessageAssistant
        | SessionMessageCompaction
        | SessionMessageModelSwitched
        | SessionMessageShell
        | SessionMessageSynthetic
        | SessionMessageUser
    ]
]:
    """Get v2 session context

     Retrieve the active context messages for a v2 session (all messages after the last compaction).

    Args:
        session_id (str):
        directory (str | Unset):
        workspace (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[InvalidRequestError | SessionNotFoundError | UnauthorizedError | UnknownError1 | list[SessionMessageAgentSwitched | SessionMessageAssistant | SessionMessageCompaction | SessionMessageModelSwitched | SessionMessageShell | SessionMessageSynthetic | SessionMessageUser]]
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
) -> (
    InvalidRequestError
    | SessionNotFoundError
    | UnauthorizedError
    | UnknownError1
    | list[
        SessionMessageAgentSwitched
        | SessionMessageAssistant
        | SessionMessageCompaction
        | SessionMessageModelSwitched
        | SessionMessageShell
        | SessionMessageSynthetic
        | SessionMessageUser
    ]
    | None
):
    """Get v2 session context

     Retrieve the active context messages for a v2 session (all messages after the last compaction).

    Args:
        session_id (str):
        directory (str | Unset):
        workspace (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        InvalidRequestError | SessionNotFoundError | UnauthorizedError | UnknownError1 | list[SessionMessageAgentSwitched | SessionMessageAssistant | SessionMessageCompaction | SessionMessageModelSwitched | SessionMessageShell | SessionMessageSynthetic | SessionMessageUser]
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
) -> Response[
    InvalidRequestError
    | SessionNotFoundError
    | UnauthorizedError
    | UnknownError1
    | list[
        SessionMessageAgentSwitched
        | SessionMessageAssistant
        | SessionMessageCompaction
        | SessionMessageModelSwitched
        | SessionMessageShell
        | SessionMessageSynthetic
        | SessionMessageUser
    ]
]:
    """Get v2 session context

     Retrieve the active context messages for a v2 session (all messages after the last compaction).

    Args:
        session_id (str):
        directory (str | Unset):
        workspace (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[InvalidRequestError | SessionNotFoundError | UnauthorizedError | UnknownError1 | list[SessionMessageAgentSwitched | SessionMessageAssistant | SessionMessageCompaction | SessionMessageModelSwitched | SessionMessageShell | SessionMessageSynthetic | SessionMessageUser]]
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
) -> (
    InvalidRequestError
    | SessionNotFoundError
    | UnauthorizedError
    | UnknownError1
    | list[
        SessionMessageAgentSwitched
        | SessionMessageAssistant
        | SessionMessageCompaction
        | SessionMessageModelSwitched
        | SessionMessageShell
        | SessionMessageSynthetic
        | SessionMessageUser
    ]
    | None
):
    """Get v2 session context

     Retrieve the active context messages for a v2 session (all messages after the last compaction).

    Args:
        session_id (str):
        directory (str | Unset):
        workspace (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        InvalidRequestError | SessionNotFoundError | UnauthorizedError | UnknownError1 | list[SessionMessageAgentSwitched | SessionMessageAssistant | SessionMessageCompaction | SessionMessageModelSwitched | SessionMessageShell | SessionMessageSynthetic | SessionMessageUser]
    """

    return (
        await asyncio_detailed(
            session_id=session_id,
            client=client,
            directory=directory,
            workspace=workspace,
        )
    ).parsed
