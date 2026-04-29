from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.event_command_executed import EventCommandExecuted
from ...models.event_file_edited import EventFileEdited
from ...models.event_file_watcher_updated import EventFileWatcherUpdated
from ...models.event_global_disposed import EventGlobalDisposed
from ...models.event_installation_update_available import EventInstallationUpdateAvailable
from ...models.event_installation_updated import EventInstallationUpdated
from ...models.event_lsp_client_diagnostics import EventLspClientDiagnostics
from ...models.event_lsp_updated import EventLspUpdated
from ...models.event_mcp_browser_open_failed import EventMcpBrowserOpenFailed
from ...models.event_mcp_tools_changed import EventMcpToolsChanged
from ...models.event_message_part_delta import EventMessagePartDelta
from ...models.event_message_part_removed import EventMessagePartRemoved
from ...models.event_message_part_updated import EventMessagePartUpdated
from ...models.event_message_removed import EventMessageRemoved
from ...models.event_message_updated import EventMessageUpdated
from ...models.event_permission_asked import EventPermissionAsked
from ...models.event_permission_replied import EventPermissionReplied
from ...models.event_project_updated import EventProjectUpdated
from ...models.event_pty_created import EventPtyCreated
from ...models.event_pty_deleted import EventPtyDeleted
from ...models.event_pty_exited import EventPtyExited
from ...models.event_pty_updated import EventPtyUpdated
from ...models.event_question_asked import EventQuestionAsked
from ...models.event_question_rejected import EventQuestionRejected
from ...models.event_question_replied import EventQuestionReplied
from ...models.event_server_connected import EventServerConnected
from ...models.event_server_instance_disposed import EventServerInstanceDisposed
from ...models.event_session_compacted import EventSessionCompacted
from ...models.event_session_created import EventSessionCreated
from ...models.event_session_deleted import EventSessionDeleted
from ...models.event_session_diff import EventSessionDiff
from ...models.event_session_error import EventSessionError
from ...models.event_session_idle import EventSessionIdle
from ...models.event_session_status import EventSessionStatus
from ...models.event_session_updated import EventSessionUpdated
from ...models.event_todo_updated import EventTodoUpdated
from ...models.event_tui_command_execute import EventTuiCommandExecute
from ...models.event_tui_prompt_append import EventTuiPromptAppend
from ...models.event_tui_session_select import EventTuiSessionSelect
from ...models.event_tui_toast_show import EventTuiToastShow
from ...models.event_vcs_branch_updated import EventVcsBranchUpdated
from ...models.event_workspace_failed import EventWorkspaceFailed
from ...models.event_workspace_ready import EventWorkspaceReady
from ...models.event_workspace_restore import EventWorkspaceRestore
from ...models.event_workspace_status import EventWorkspaceStatus
from ...models.event_worktree_failed import EventWorktreeFailed
from ...models.event_worktree_ready import EventWorktreeReady
from ...types import UNSET, Response, Unset


def _get_kwargs(
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
        "url": "/event",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    EventCommandExecuted
    | EventFileEdited
    | EventFileWatcherUpdated
    | EventGlobalDisposed
    | EventInstallationUpdateAvailable
    | EventInstallationUpdated
    | EventLspClientDiagnostics
    | EventLspUpdated
    | EventMcpBrowserOpenFailed
    | EventMcpToolsChanged
    | EventMessagePartDelta
    | EventMessagePartRemoved
    | EventMessagePartUpdated
    | EventMessageRemoved
    | EventMessageUpdated
    | EventPermissionAsked
    | EventPermissionReplied
    | EventProjectUpdated
    | EventPtyCreated
    | EventPtyDeleted
    | EventPtyExited
    | EventPtyUpdated
    | EventQuestionAsked
    | EventQuestionRejected
    | EventQuestionReplied
    | EventServerConnected
    | EventServerInstanceDisposed
    | EventSessionCompacted
    | EventSessionCreated
    | EventSessionDeleted
    | EventSessionDiff
    | EventSessionError
    | EventSessionIdle
    | EventSessionStatus
    | EventSessionUpdated
    | EventTodoUpdated
    | EventTuiCommandExecute
    | EventTuiPromptAppend
    | EventTuiSessionSelect
    | EventTuiToastShow
    | EventVcsBranchUpdated
    | EventWorkspaceFailed
    | EventWorkspaceReady
    | EventWorkspaceRestore
    | EventWorkspaceStatus
    | EventWorktreeFailed
    | EventWorktreeReady
    | None
):
    if response.status_code == 200:

        def _parse_response_200(
            data: object,
        ) -> (
            EventCommandExecuted
            | EventFileEdited
            | EventFileWatcherUpdated
            | EventGlobalDisposed
            | EventInstallationUpdateAvailable
            | EventInstallationUpdated
            | EventLspClientDiagnostics
            | EventLspUpdated
            | EventMcpBrowserOpenFailed
            | EventMcpToolsChanged
            | EventMessagePartDelta
            | EventMessagePartRemoved
            | EventMessagePartUpdated
            | EventMessageRemoved
            | EventMessageUpdated
            | EventPermissionAsked
            | EventPermissionReplied
            | EventProjectUpdated
            | EventPtyCreated
            | EventPtyDeleted
            | EventPtyExited
            | EventPtyUpdated
            | EventQuestionAsked
            | EventQuestionRejected
            | EventQuestionReplied
            | EventServerConnected
            | EventServerInstanceDisposed
            | EventSessionCompacted
            | EventSessionCreated
            | EventSessionDeleted
            | EventSessionDiff
            | EventSessionError
            | EventSessionIdle
            | EventSessionStatus
            | EventSessionUpdated
            | EventTodoUpdated
            | EventTuiCommandExecute
            | EventTuiPromptAppend
            | EventTuiSessionSelect
            | EventTuiToastShow
            | EventVcsBranchUpdated
            | EventWorkspaceFailed
            | EventWorkspaceReady
            | EventWorkspaceRestore
            | EventWorkspaceStatus
            | EventWorktreeFailed
            | EventWorktreeReady
        ):
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_0 = EventProjectUpdated.from_dict(data)

                return componentsschemas_event_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_1 = EventServerInstanceDisposed.from_dict(data)

                return componentsschemas_event_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_2 = EventServerConnected.from_dict(data)

                return componentsschemas_event_type_2
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_3 = EventGlobalDisposed.from_dict(data)

                return componentsschemas_event_type_3
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_4 = EventFileEdited.from_dict(data)

                return componentsschemas_event_type_4
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_5 = EventFileWatcherUpdated.from_dict(data)

                return componentsschemas_event_type_5
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_6 = EventLspClientDiagnostics.from_dict(data)

                return componentsschemas_event_type_6
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_7 = EventLspUpdated.from_dict(data)

                return componentsschemas_event_type_7
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_8 = EventMessagePartDelta.from_dict(data)

                return componentsschemas_event_type_8
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_9 = EventPermissionAsked.from_dict(data)

                return componentsschemas_event_type_9
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_10 = EventPermissionReplied.from_dict(data)

                return componentsschemas_event_type_10
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_11 = EventSessionDiff.from_dict(data)

                return componentsschemas_event_type_11
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_12 = EventSessionError.from_dict(data)

                return componentsschemas_event_type_12
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_13 = EventInstallationUpdated.from_dict(data)

                return componentsschemas_event_type_13
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_14 = EventInstallationUpdateAvailable.from_dict(data)

                return componentsschemas_event_type_14
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_15 = EventQuestionAsked.from_dict(data)

                return componentsschemas_event_type_15
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_16 = EventQuestionReplied.from_dict(data)

                return componentsschemas_event_type_16
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_17 = EventQuestionRejected.from_dict(data)

                return componentsschemas_event_type_17
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_18 = EventTodoUpdated.from_dict(data)

                return componentsschemas_event_type_18
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_19 = EventSessionStatus.from_dict(data)

                return componentsschemas_event_type_19
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_20 = EventSessionIdle.from_dict(data)

                return componentsschemas_event_type_20
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_21 = EventSessionCompacted.from_dict(data)

                return componentsschemas_event_type_21
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_22 = EventTuiPromptAppend.from_dict(data)

                return componentsschemas_event_type_22
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_23 = EventTuiCommandExecute.from_dict(data)

                return componentsschemas_event_type_23
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_24 = EventTuiToastShow.from_dict(data)

                return componentsschemas_event_type_24
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_25 = EventTuiSessionSelect.from_dict(data)

                return componentsschemas_event_type_25
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_26 = EventMcpToolsChanged.from_dict(data)

                return componentsschemas_event_type_26
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_27 = EventMcpBrowserOpenFailed.from_dict(data)

                return componentsschemas_event_type_27
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_28 = EventCommandExecuted.from_dict(data)

                return componentsschemas_event_type_28
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_29 = EventVcsBranchUpdated.from_dict(data)

                return componentsschemas_event_type_29
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_30 = EventWorktreeReady.from_dict(data)

                return componentsschemas_event_type_30
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_31 = EventWorktreeFailed.from_dict(data)

                return componentsschemas_event_type_31
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_32 = EventPtyCreated.from_dict(data)

                return componentsschemas_event_type_32
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_33 = EventPtyUpdated.from_dict(data)

                return componentsschemas_event_type_33
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_34 = EventPtyExited.from_dict(data)

                return componentsschemas_event_type_34
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_35 = EventPtyDeleted.from_dict(data)

                return componentsschemas_event_type_35
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_36 = EventWorkspaceReady.from_dict(data)

                return componentsschemas_event_type_36
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_37 = EventWorkspaceFailed.from_dict(data)

                return componentsschemas_event_type_37
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_38 = EventWorkspaceRestore.from_dict(data)

                return componentsschemas_event_type_38
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_39 = EventWorkspaceStatus.from_dict(data)

                return componentsschemas_event_type_39
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_40 = EventMessageUpdated.from_dict(data)

                return componentsschemas_event_type_40
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_41 = EventMessageRemoved.from_dict(data)

                return componentsschemas_event_type_41
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_42 = EventMessagePartUpdated.from_dict(data)

                return componentsschemas_event_type_42
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_43 = EventMessagePartRemoved.from_dict(data)

                return componentsschemas_event_type_43
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_44 = EventSessionCreated.from_dict(data)

                return componentsschemas_event_type_44
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_45 = EventSessionUpdated.from_dict(data)

                return componentsschemas_event_type_45
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            componentsschemas_event_type_46 = EventSessionDeleted.from_dict(data)

            return componentsschemas_event_type_46

        response_200 = _parse_response_200(response.text)

        return response_200

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    EventCommandExecuted
    | EventFileEdited
    | EventFileWatcherUpdated
    | EventGlobalDisposed
    | EventInstallationUpdateAvailable
    | EventInstallationUpdated
    | EventLspClientDiagnostics
    | EventLspUpdated
    | EventMcpBrowserOpenFailed
    | EventMcpToolsChanged
    | EventMessagePartDelta
    | EventMessagePartRemoved
    | EventMessagePartUpdated
    | EventMessageRemoved
    | EventMessageUpdated
    | EventPermissionAsked
    | EventPermissionReplied
    | EventProjectUpdated
    | EventPtyCreated
    | EventPtyDeleted
    | EventPtyExited
    | EventPtyUpdated
    | EventQuestionAsked
    | EventQuestionRejected
    | EventQuestionReplied
    | EventServerConnected
    | EventServerInstanceDisposed
    | EventSessionCompacted
    | EventSessionCreated
    | EventSessionDeleted
    | EventSessionDiff
    | EventSessionError
    | EventSessionIdle
    | EventSessionStatus
    | EventSessionUpdated
    | EventTodoUpdated
    | EventTuiCommandExecute
    | EventTuiPromptAppend
    | EventTuiSessionSelect
    | EventTuiToastShow
    | EventVcsBranchUpdated
    | EventWorkspaceFailed
    | EventWorkspaceReady
    | EventWorkspaceRestore
    | EventWorkspaceStatus
    | EventWorktreeFailed
    | EventWorktreeReady
]:
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
) -> Response[
    EventCommandExecuted
    | EventFileEdited
    | EventFileWatcherUpdated
    | EventGlobalDisposed
    | EventInstallationUpdateAvailable
    | EventInstallationUpdated
    | EventLspClientDiagnostics
    | EventLspUpdated
    | EventMcpBrowserOpenFailed
    | EventMcpToolsChanged
    | EventMessagePartDelta
    | EventMessagePartRemoved
    | EventMessagePartUpdated
    | EventMessageRemoved
    | EventMessageUpdated
    | EventPermissionAsked
    | EventPermissionReplied
    | EventProjectUpdated
    | EventPtyCreated
    | EventPtyDeleted
    | EventPtyExited
    | EventPtyUpdated
    | EventQuestionAsked
    | EventQuestionRejected
    | EventQuestionReplied
    | EventServerConnected
    | EventServerInstanceDisposed
    | EventSessionCompacted
    | EventSessionCreated
    | EventSessionDeleted
    | EventSessionDiff
    | EventSessionError
    | EventSessionIdle
    | EventSessionStatus
    | EventSessionUpdated
    | EventTodoUpdated
    | EventTuiCommandExecute
    | EventTuiPromptAppend
    | EventTuiSessionSelect
    | EventTuiToastShow
    | EventVcsBranchUpdated
    | EventWorkspaceFailed
    | EventWorkspaceReady
    | EventWorkspaceRestore
    | EventWorkspaceStatus
    | EventWorktreeFailed
    | EventWorktreeReady
]:
    """Subscribe to events

     Get events

    Args:
        directory (str | Unset):
        workspace (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[EventCommandExecuted | EventFileEdited | EventFileWatcherUpdated | EventGlobalDisposed | EventInstallationUpdateAvailable | EventInstallationUpdated | EventLspClientDiagnostics | EventLspUpdated | EventMcpBrowserOpenFailed | EventMcpToolsChanged | EventMessagePartDelta | EventMessagePartRemoved | EventMessagePartUpdated | EventMessageRemoved | EventMessageUpdated | EventPermissionAsked | EventPermissionReplied | EventProjectUpdated | EventPtyCreated | EventPtyDeleted | EventPtyExited | EventPtyUpdated | EventQuestionAsked | EventQuestionRejected | EventQuestionReplied | EventServerConnected | EventServerInstanceDisposed | EventSessionCompacted | EventSessionCreated | EventSessionDeleted | EventSessionDiff | EventSessionError | EventSessionIdle | EventSessionStatus | EventSessionUpdated | EventTodoUpdated | EventTuiCommandExecute | EventTuiPromptAppend | EventTuiSessionSelect | EventTuiToastShow | EventVcsBranchUpdated | EventWorkspaceFailed | EventWorkspaceReady | EventWorkspaceRestore | EventWorkspaceStatus | EventWorktreeFailed | EventWorktreeReady]
    """

    kwargs = _get_kwargs(
        directory=directory,
        workspace=workspace,
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
) -> (
    EventCommandExecuted
    | EventFileEdited
    | EventFileWatcherUpdated
    | EventGlobalDisposed
    | EventInstallationUpdateAvailable
    | EventInstallationUpdated
    | EventLspClientDiagnostics
    | EventLspUpdated
    | EventMcpBrowserOpenFailed
    | EventMcpToolsChanged
    | EventMessagePartDelta
    | EventMessagePartRemoved
    | EventMessagePartUpdated
    | EventMessageRemoved
    | EventMessageUpdated
    | EventPermissionAsked
    | EventPermissionReplied
    | EventProjectUpdated
    | EventPtyCreated
    | EventPtyDeleted
    | EventPtyExited
    | EventPtyUpdated
    | EventQuestionAsked
    | EventQuestionRejected
    | EventQuestionReplied
    | EventServerConnected
    | EventServerInstanceDisposed
    | EventSessionCompacted
    | EventSessionCreated
    | EventSessionDeleted
    | EventSessionDiff
    | EventSessionError
    | EventSessionIdle
    | EventSessionStatus
    | EventSessionUpdated
    | EventTodoUpdated
    | EventTuiCommandExecute
    | EventTuiPromptAppend
    | EventTuiSessionSelect
    | EventTuiToastShow
    | EventVcsBranchUpdated
    | EventWorkspaceFailed
    | EventWorkspaceReady
    | EventWorkspaceRestore
    | EventWorkspaceStatus
    | EventWorktreeFailed
    | EventWorktreeReady
    | None
):
    """Subscribe to events

     Get events

    Args:
        directory (str | Unset):
        workspace (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        EventCommandExecuted | EventFileEdited | EventFileWatcherUpdated | EventGlobalDisposed | EventInstallationUpdateAvailable | EventInstallationUpdated | EventLspClientDiagnostics | EventLspUpdated | EventMcpBrowserOpenFailed | EventMcpToolsChanged | EventMessagePartDelta | EventMessagePartRemoved | EventMessagePartUpdated | EventMessageRemoved | EventMessageUpdated | EventPermissionAsked | EventPermissionReplied | EventProjectUpdated | EventPtyCreated | EventPtyDeleted | EventPtyExited | EventPtyUpdated | EventQuestionAsked | EventQuestionRejected | EventQuestionReplied | EventServerConnected | EventServerInstanceDisposed | EventSessionCompacted | EventSessionCreated | EventSessionDeleted | EventSessionDiff | EventSessionError | EventSessionIdle | EventSessionStatus | EventSessionUpdated | EventTodoUpdated | EventTuiCommandExecute | EventTuiPromptAppend | EventTuiSessionSelect | EventTuiToastShow | EventVcsBranchUpdated | EventWorkspaceFailed | EventWorkspaceReady | EventWorkspaceRestore | EventWorkspaceStatus | EventWorktreeFailed | EventWorktreeReady
    """

    return sync_detailed(
        client=client,
        directory=directory,
        workspace=workspace,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
) -> Response[
    EventCommandExecuted
    | EventFileEdited
    | EventFileWatcherUpdated
    | EventGlobalDisposed
    | EventInstallationUpdateAvailable
    | EventInstallationUpdated
    | EventLspClientDiagnostics
    | EventLspUpdated
    | EventMcpBrowserOpenFailed
    | EventMcpToolsChanged
    | EventMessagePartDelta
    | EventMessagePartRemoved
    | EventMessagePartUpdated
    | EventMessageRemoved
    | EventMessageUpdated
    | EventPermissionAsked
    | EventPermissionReplied
    | EventProjectUpdated
    | EventPtyCreated
    | EventPtyDeleted
    | EventPtyExited
    | EventPtyUpdated
    | EventQuestionAsked
    | EventQuestionRejected
    | EventQuestionReplied
    | EventServerConnected
    | EventServerInstanceDisposed
    | EventSessionCompacted
    | EventSessionCreated
    | EventSessionDeleted
    | EventSessionDiff
    | EventSessionError
    | EventSessionIdle
    | EventSessionStatus
    | EventSessionUpdated
    | EventTodoUpdated
    | EventTuiCommandExecute
    | EventTuiPromptAppend
    | EventTuiSessionSelect
    | EventTuiToastShow
    | EventVcsBranchUpdated
    | EventWorkspaceFailed
    | EventWorkspaceReady
    | EventWorkspaceRestore
    | EventWorkspaceStatus
    | EventWorktreeFailed
    | EventWorktreeReady
]:
    """Subscribe to events

     Get events

    Args:
        directory (str | Unset):
        workspace (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[EventCommandExecuted | EventFileEdited | EventFileWatcherUpdated | EventGlobalDisposed | EventInstallationUpdateAvailable | EventInstallationUpdated | EventLspClientDiagnostics | EventLspUpdated | EventMcpBrowserOpenFailed | EventMcpToolsChanged | EventMessagePartDelta | EventMessagePartRemoved | EventMessagePartUpdated | EventMessageRemoved | EventMessageUpdated | EventPermissionAsked | EventPermissionReplied | EventProjectUpdated | EventPtyCreated | EventPtyDeleted | EventPtyExited | EventPtyUpdated | EventQuestionAsked | EventQuestionRejected | EventQuestionReplied | EventServerConnected | EventServerInstanceDisposed | EventSessionCompacted | EventSessionCreated | EventSessionDeleted | EventSessionDiff | EventSessionError | EventSessionIdle | EventSessionStatus | EventSessionUpdated | EventTodoUpdated | EventTuiCommandExecute | EventTuiPromptAppend | EventTuiSessionSelect | EventTuiToastShow | EventVcsBranchUpdated | EventWorkspaceFailed | EventWorkspaceReady | EventWorkspaceRestore | EventWorkspaceStatus | EventWorktreeFailed | EventWorktreeReady]
    """

    kwargs = _get_kwargs(
        directory=directory,
        workspace=workspace,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
) -> (
    EventCommandExecuted
    | EventFileEdited
    | EventFileWatcherUpdated
    | EventGlobalDisposed
    | EventInstallationUpdateAvailable
    | EventInstallationUpdated
    | EventLspClientDiagnostics
    | EventLspUpdated
    | EventMcpBrowserOpenFailed
    | EventMcpToolsChanged
    | EventMessagePartDelta
    | EventMessagePartRemoved
    | EventMessagePartUpdated
    | EventMessageRemoved
    | EventMessageUpdated
    | EventPermissionAsked
    | EventPermissionReplied
    | EventProjectUpdated
    | EventPtyCreated
    | EventPtyDeleted
    | EventPtyExited
    | EventPtyUpdated
    | EventQuestionAsked
    | EventQuestionRejected
    | EventQuestionReplied
    | EventServerConnected
    | EventServerInstanceDisposed
    | EventSessionCompacted
    | EventSessionCreated
    | EventSessionDeleted
    | EventSessionDiff
    | EventSessionError
    | EventSessionIdle
    | EventSessionStatus
    | EventSessionUpdated
    | EventTodoUpdated
    | EventTuiCommandExecute
    | EventTuiPromptAppend
    | EventTuiSessionSelect
    | EventTuiToastShow
    | EventVcsBranchUpdated
    | EventWorkspaceFailed
    | EventWorkspaceReady
    | EventWorkspaceRestore
    | EventWorkspaceStatus
    | EventWorktreeFailed
    | EventWorktreeReady
    | None
):
    """Subscribe to events

     Get events

    Args:
        directory (str | Unset):
        workspace (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        EventCommandExecuted | EventFileEdited | EventFileWatcherUpdated | EventGlobalDisposed | EventInstallationUpdateAvailable | EventInstallationUpdated | EventLspClientDiagnostics | EventLspUpdated | EventMcpBrowserOpenFailed | EventMcpToolsChanged | EventMessagePartDelta | EventMessagePartRemoved | EventMessagePartUpdated | EventMessageRemoved | EventMessageUpdated | EventPermissionAsked | EventPermissionReplied | EventProjectUpdated | EventPtyCreated | EventPtyDeleted | EventPtyExited | EventPtyUpdated | EventQuestionAsked | EventQuestionRejected | EventQuestionReplied | EventServerConnected | EventServerInstanceDisposed | EventSessionCompacted | EventSessionCreated | EventSessionDeleted | EventSessionDiff | EventSessionError | EventSessionIdle | EventSessionStatus | EventSessionUpdated | EventTodoUpdated | EventTuiCommandExecute | EventTuiPromptAppend | EventTuiSessionSelect | EventTuiToastShow | EventVcsBranchUpdated | EventWorkspaceFailed | EventWorkspaceReady | EventWorkspaceRestore | EventWorkspaceStatus | EventWorktreeFailed | EventWorktreeReady
    """

    return (
        await asyncio_detailed(
            client=client,
            directory=directory,
            workspace=workspace,
        )
    ).parsed
