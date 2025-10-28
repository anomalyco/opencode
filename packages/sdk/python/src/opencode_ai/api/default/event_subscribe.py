from http import HTTPStatus
from typing import Any, Optional, Union

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.event_file_edited import EventFileEdited
from ...models.event_file_watcher_updated import EventFileWatcherUpdated
from ...models.event_ide_installed import EventIdeInstalled
from ...models.event_installation_updated import EventInstallationUpdated
from ...models.event_lsp_client_diagnostics import EventLspClientDiagnostics
from ...models.event_message_part_removed import EventMessagePartRemoved
from ...models.event_message_part_updated import EventMessagePartUpdated
from ...models.event_message_removed import EventMessageRemoved
from ...models.event_message_updated import EventMessageUpdated
from ...models.event_permission_replied import EventPermissionReplied
from ...models.event_permission_updated import EventPermissionUpdated
from ...models.event_server_connected import EventServerConnected
from ...models.event_session_compacted import EventSessionCompacted
from ...models.event_session_deleted import EventSessionDeleted
from ...models.event_session_error import EventSessionError
from ...models.event_session_idle import EventSessionIdle
from ...models.event_session_updated import EventSessionUpdated
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    directory: Union[Unset, str] = UNSET,
) -> dict[str, Any]:
    params: dict[str, Any] = {}

    params["directory"] = directory

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/event",
        "params": params,
    }

    return _kwargs


def _parse_response(*, client: Union[AuthenticatedClient, Client], response: httpx.Response) -> Optional[
    Union[
        "EventFileEdited",
        "EventFileWatcherUpdated",
        "EventIdeInstalled",
        "EventInstallationUpdated",
        "EventLspClientDiagnostics",
        "EventMessagePartRemoved",
        "EventMessagePartUpdated",
        "EventMessageRemoved",
        "EventMessageUpdated",
        "EventPermissionReplied",
        "EventPermissionUpdated",
        "EventServerConnected",
        "EventSessionCompacted",
        "EventSessionDeleted",
        "EventSessionError",
        "EventSessionIdle",
        "EventSessionUpdated",
    ]
]:
    if response.status_code == 200:

        def _parse_response_200(
            data: object,
        ) -> Union[
            "EventFileEdited",
            "EventFileWatcherUpdated",
            "EventIdeInstalled",
            "EventInstallationUpdated",
            "EventLspClientDiagnostics",
            "EventMessagePartRemoved",
            "EventMessagePartUpdated",
            "EventMessageRemoved",
            "EventMessageUpdated",
            "EventPermissionReplied",
            "EventPermissionUpdated",
            "EventServerConnected",
            "EventSessionCompacted",
            "EventSessionDeleted",
            "EventSessionError",
            "EventSessionIdle",
            "EventSessionUpdated",
        ]:
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_0 = EventInstallationUpdated.from_dict(data)

                return componentsschemas_event_type_0
            except:  # noqa: E722
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_1 = EventLspClientDiagnostics.from_dict(data)

                return componentsschemas_event_type_1
            except:  # noqa: E722
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_2 = EventMessageUpdated.from_dict(data)

                return componentsschemas_event_type_2
            except:  # noqa: E722
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_3 = EventMessageRemoved.from_dict(data)

                return componentsschemas_event_type_3
            except:  # noqa: E722
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_4 = EventMessagePartUpdated.from_dict(data)

                return componentsschemas_event_type_4
            except:  # noqa: E722
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_5 = EventMessagePartRemoved.from_dict(data)

                return componentsschemas_event_type_5
            except:  # noqa: E722
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_6 = EventSessionCompacted.from_dict(data)

                return componentsschemas_event_type_6
            except:  # noqa: E722
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_7 = EventPermissionUpdated.from_dict(data)

                return componentsschemas_event_type_7
            except:  # noqa: E722
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_8 = EventPermissionReplied.from_dict(data)

                return componentsschemas_event_type_8
            except:  # noqa: E722
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_9 = EventFileEdited.from_dict(data)

                return componentsschemas_event_type_9
            except:  # noqa: E722
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_10 = EventSessionIdle.from_dict(data)

                return componentsschemas_event_type_10
            except:  # noqa: E722
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_11 = EventSessionUpdated.from_dict(data)

                return componentsschemas_event_type_11
            except:  # noqa: E722
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_12 = EventSessionDeleted.from_dict(data)

                return componentsschemas_event_type_12
            except:  # noqa: E722
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_13 = EventSessionError.from_dict(data)

                return componentsschemas_event_type_13
            except:  # noqa: E722
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_14 = EventFileWatcherUpdated.from_dict(data)

                return componentsschemas_event_type_14
            except:  # noqa: E722
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_15 = EventServerConnected.from_dict(data)

                return componentsschemas_event_type_15
            except:  # noqa: E722
                pass
            if not isinstance(data, dict):
                raise TypeError()
            componentsschemas_event_type_16 = EventIdeInstalled.from_dict(data)

            return componentsschemas_event_type_16

        response_200 = _parse_response_200(response.text)

        return response_200

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(*, client: Union[AuthenticatedClient, Client], response: httpx.Response) -> Response[
    Union[
        "EventFileEdited",
        "EventFileWatcherUpdated",
        "EventIdeInstalled",
        "EventInstallationUpdated",
        "EventLspClientDiagnostics",
        "EventMessagePartRemoved",
        "EventMessagePartUpdated",
        "EventMessageRemoved",
        "EventMessageUpdated",
        "EventPermissionReplied",
        "EventPermissionUpdated",
        "EventServerConnected",
        "EventSessionCompacted",
        "EventSessionDeleted",
        "EventSessionError",
        "EventSessionIdle",
        "EventSessionUpdated",
    ]
]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: Union[AuthenticatedClient, Client],
    directory: Union[Unset, str] = UNSET,
) -> Response[
    Union[
        "EventFileEdited",
        "EventFileWatcherUpdated",
        "EventIdeInstalled",
        "EventInstallationUpdated",
        "EventLspClientDiagnostics",
        "EventMessagePartRemoved",
        "EventMessagePartUpdated",
        "EventMessageRemoved",
        "EventMessageUpdated",
        "EventPermissionReplied",
        "EventPermissionUpdated",
        "EventServerConnected",
        "EventSessionCompacted",
        "EventSessionDeleted",
        "EventSessionError",
        "EventSessionIdle",
        "EventSessionUpdated",
    ]
]:
    """Get events

    Args:
        directory (Union[Unset, str]):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union['EventFileEdited', 'EventFileWatcherUpdated', 'EventIdeInstalled', 'EventInstallationUpdated', 'EventLspClientDiagnostics', 'EventMessagePartRemoved', 'EventMessagePartUpdated', 'EventMessageRemoved', 'EventMessageUpdated', 'EventPermissionReplied', 'EventPermissionUpdated', 'EventServerConnected', 'EventSessionCompacted', 'EventSessionDeleted', 'EventSessionError', 'EventSessionIdle', 'EventSessionUpdated']]
    """

    kwargs = _get_kwargs(
        directory=directory,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: Union[AuthenticatedClient, Client],
    directory: Union[Unset, str] = UNSET,
) -> Optional[
    Union[
        "EventFileEdited",
        "EventFileWatcherUpdated",
        "EventIdeInstalled",
        "EventInstallationUpdated",
        "EventLspClientDiagnostics",
        "EventMessagePartRemoved",
        "EventMessagePartUpdated",
        "EventMessageRemoved",
        "EventMessageUpdated",
        "EventPermissionReplied",
        "EventPermissionUpdated",
        "EventServerConnected",
        "EventSessionCompacted",
        "EventSessionDeleted",
        "EventSessionError",
        "EventSessionIdle",
        "EventSessionUpdated",
    ]
]:
    """Get events

    Args:
        directory (Union[Unset, str]):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union['EventFileEdited', 'EventFileWatcherUpdated', 'EventIdeInstalled', 'EventInstallationUpdated', 'EventLspClientDiagnostics', 'EventMessagePartRemoved', 'EventMessagePartUpdated', 'EventMessageRemoved', 'EventMessageUpdated', 'EventPermissionReplied', 'EventPermissionUpdated', 'EventServerConnected', 'EventSessionCompacted', 'EventSessionDeleted', 'EventSessionError', 'EventSessionIdle', 'EventSessionUpdated']
    """

    return sync_detailed(
        client=client,
        directory=directory,
    ).parsed


async def asyncio_detailed(
    *,
    client: Union[AuthenticatedClient, Client],
    directory: Union[Unset, str] = UNSET,
) -> Response[
    Union[
        "EventFileEdited",
        "EventFileWatcherUpdated",
        "EventIdeInstalled",
        "EventInstallationUpdated",
        "EventLspClientDiagnostics",
        "EventMessagePartRemoved",
        "EventMessagePartUpdated",
        "EventMessageRemoved",
        "EventMessageUpdated",
        "EventPermissionReplied",
        "EventPermissionUpdated",
        "EventServerConnected",
        "EventSessionCompacted",
        "EventSessionDeleted",
        "EventSessionError",
        "EventSessionIdle",
        "EventSessionUpdated",
    ]
]:
    """Get events

    Args:
        directory (Union[Unset, str]):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union['EventFileEdited', 'EventFileWatcherUpdated', 'EventIdeInstalled', 'EventInstallationUpdated', 'EventLspClientDiagnostics', 'EventMessagePartRemoved', 'EventMessagePartUpdated', 'EventMessageRemoved', 'EventMessageUpdated', 'EventPermissionReplied', 'EventPermissionUpdated', 'EventServerConnected', 'EventSessionCompacted', 'EventSessionDeleted', 'EventSessionError', 'EventSessionIdle', 'EventSessionUpdated']]
    """

    kwargs = _get_kwargs(
        directory=directory,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: Union[AuthenticatedClient, Client],
    directory: Union[Unset, str] = UNSET,
) -> Optional[
    Union[
        "EventFileEdited",
        "EventFileWatcherUpdated",
        "EventIdeInstalled",
        "EventInstallationUpdated",
        "EventLspClientDiagnostics",
        "EventMessagePartRemoved",
        "EventMessagePartUpdated",
        "EventMessageRemoved",
        "EventMessageUpdated",
        "EventPermissionReplied",
        "EventPermissionUpdated",
        "EventServerConnected",
        "EventSessionCompacted",
        "EventSessionDeleted",
        "EventSessionError",
        "EventSessionIdle",
        "EventSessionUpdated",
    ]
]:
    """Get events

    Args:
        directory (Union[Unset, str]):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union['EventFileEdited', 'EventFileWatcherUpdated', 'EventIdeInstalled', 'EventInstallationUpdated', 'EventLspClientDiagnostics', 'EventMessagePartRemoved', 'EventMessagePartUpdated', 'EventMessageRemoved', 'EventMessageUpdated', 'EventPermissionReplied', 'EventPermissionUpdated', 'EventServerConnected', 'EventSessionCompacted', 'EventSessionDeleted', 'EventSessionError', 'EventSessionIdle', 'EventSessionUpdated']
    """

    return (
        await asyncio_detailed(
            client=client,
            directory=directory,
        )
    ).parsed
