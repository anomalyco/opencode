from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.event_account_added import EventAccountAdded
from ...models.event_account_removed import EventAccountRemoved
from ...models.event_account_switched import EventAccountSwitched
from ...models.event_catalog_model_updated import EventCatalogModelUpdated
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
from ...models.event_models_dev_refreshed import EventModelsDevRefreshed
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
from ...models.event_session_next_agent_switched import EventSessionNextAgentSwitched
from ...models.event_session_next_compaction_delta import EventSessionNextCompactionDelta
from ...models.event_session_next_compaction_ended import EventSessionNextCompactionEnded
from ...models.event_session_next_compaction_started import EventSessionNextCompactionStarted
from ...models.event_session_next_model_switched import EventSessionNextModelSwitched
from ...models.event_session_next_prompted import EventSessionNextPrompted
from ...models.event_session_next_reasoning_delta import EventSessionNextReasoningDelta
from ...models.event_session_next_reasoning_ended import EventSessionNextReasoningEnded
from ...models.event_session_next_reasoning_started import EventSessionNextReasoningStarted
from ...models.event_session_next_retried import EventSessionNextRetried
from ...models.event_session_next_shell_ended import EventSessionNextShellEnded
from ...models.event_session_next_shell_started import EventSessionNextShellStarted
from ...models.event_session_next_step_ended import EventSessionNextStepEnded
from ...models.event_session_next_step_failed import EventSessionNextStepFailed
from ...models.event_session_next_step_started import EventSessionNextStepStarted
from ...models.event_session_next_synthetic import EventSessionNextSynthetic
from ...models.event_session_next_text_delta import EventSessionNextTextDelta
from ...models.event_session_next_text_ended import EventSessionNextTextEnded
from ...models.event_session_next_text_started import EventSessionNextTextStarted
from ...models.event_session_next_tool_called import EventSessionNextToolCalled
from ...models.event_session_next_tool_failed import EventSessionNextToolFailed
from ...models.event_session_next_tool_input_delta import EventSessionNextToolInputDelta
from ...models.event_session_next_tool_input_ended import EventSessionNextToolInputEnded
from ...models.event_session_next_tool_input_started import EventSessionNextToolInputStarted
from ...models.event_session_next_tool_progress import EventSessionNextToolProgress
from ...models.event_session_next_tool_success import EventSessionNextToolSuccess
from ...models.event_session_status import EventSessionStatus
from ...models.event_session_updated import EventSessionUpdated
from ...models.event_todo_updated import EventTodoUpdated
from ...models.event_tui_command_execute import EventTuiCommandExecute
from ...models.event_tui_prompt_append import EventTuiPromptAppend
from ...models.event_tui_session_select import EventTuiSessionSelect
from ...models.event_tui_toast_show_1 import EventTuiToastShow1
from ...models.event_vcs_branch_updated import EventVcsBranchUpdated
from ...models.event_workspace_failed import EventWorkspaceFailed
from ...models.event_workspace_ready import EventWorkspaceReady
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
    EventAccountAdded
    | EventAccountRemoved
    | EventAccountSwitched
    | EventCatalogModelUpdated
    | EventCommandExecuted
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
    | EventModelsDevRefreshed
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
    | EventSessionNextAgentSwitched
    | EventSessionNextCompactionDelta
    | EventSessionNextCompactionEnded
    | EventSessionNextCompactionStarted
    | EventSessionNextModelSwitched
    | EventSessionNextPrompted
    | EventSessionNextReasoningDelta
    | EventSessionNextReasoningEnded
    | EventSessionNextReasoningStarted
    | EventSessionNextRetried
    | EventSessionNextShellEnded
    | EventSessionNextShellStarted
    | EventSessionNextStepEnded
    | EventSessionNextStepFailed
    | EventSessionNextStepStarted
    | EventSessionNextSynthetic
    | EventSessionNextTextDelta
    | EventSessionNextTextEnded
    | EventSessionNextTextStarted
    | EventSessionNextToolCalled
    | EventSessionNextToolFailed
    | EventSessionNextToolInputDelta
    | EventSessionNextToolInputEnded
    | EventSessionNextToolInputStarted
    | EventSessionNextToolProgress
    | EventSessionNextToolSuccess
    | EventSessionStatus
    | EventSessionUpdated
    | EventTodoUpdated
    | EventTuiCommandExecute
    | EventTuiPromptAppend
    | EventTuiSessionSelect
    | EventTuiToastShow1
    | EventVcsBranchUpdated
    | EventWorkspaceFailed
    | EventWorkspaceReady
    | EventWorkspaceStatus
    | EventWorktreeFailed
    | EventWorktreeReady
    | None
):
    if response.status_code == 200:

        def _parse_response_200(
            data: object,
        ) -> (
            EventAccountAdded
            | EventAccountRemoved
            | EventAccountSwitched
            | EventCatalogModelUpdated
            | EventCommandExecuted
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
            | EventModelsDevRefreshed
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
            | EventSessionNextAgentSwitched
            | EventSessionNextCompactionDelta
            | EventSessionNextCompactionEnded
            | EventSessionNextCompactionStarted
            | EventSessionNextModelSwitched
            | EventSessionNextPrompted
            | EventSessionNextReasoningDelta
            | EventSessionNextReasoningEnded
            | EventSessionNextReasoningStarted
            | EventSessionNextRetried
            | EventSessionNextShellEnded
            | EventSessionNextShellStarted
            | EventSessionNextStepEnded
            | EventSessionNextStepFailed
            | EventSessionNextStepStarted
            | EventSessionNextSynthetic
            | EventSessionNextTextDelta
            | EventSessionNextTextEnded
            | EventSessionNextTextStarted
            | EventSessionNextToolCalled
            | EventSessionNextToolFailed
            | EventSessionNextToolInputDelta
            | EventSessionNextToolInputEnded
            | EventSessionNextToolInputStarted
            | EventSessionNextToolProgress
            | EventSessionNextToolSuccess
            | EventSessionStatus
            | EventSessionUpdated
            | EventTodoUpdated
            | EventTuiCommandExecute
            | EventTuiPromptAppend
            | EventTuiSessionSelect
            | EventTuiToastShow1
            | EventVcsBranchUpdated
            | EventWorkspaceFailed
            | EventWorkspaceReady
            | EventWorkspaceStatus
            | EventWorktreeFailed
            | EventWorktreeReady
        ):
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_0 = EventTuiPromptAppend.from_dict(data)

                return componentsschemas_event_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_1 = EventTuiCommandExecute.from_dict(data)

                return componentsschemas_event_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_2 = EventTuiToastShow1.from_dict(data)

                return componentsschemas_event_type_2
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_3 = EventTuiSessionSelect.from_dict(data)

                return componentsschemas_event_type_3
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_4 = EventServerConnected.from_dict(data)

                return componentsschemas_event_type_4
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_5 = EventGlobalDisposed.from_dict(data)

                return componentsschemas_event_type_5
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_6 = EventServerInstanceDisposed.from_dict(data)

                return componentsschemas_event_type_6
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_7 = EventFileEdited.from_dict(data)

                return componentsschemas_event_type_7
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_8 = EventFileWatcherUpdated.from_dict(data)

                return componentsschemas_event_type_8
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_9 = EventLspClientDiagnostics.from_dict(data)

                return componentsschemas_event_type_9
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_10 = EventLspUpdated.from_dict(data)

                return componentsschemas_event_type_10
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_11 = EventMessagePartDelta.from_dict(data)

                return componentsschemas_event_type_11
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_12 = EventPermissionAsked.from_dict(data)

                return componentsschemas_event_type_12
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_13 = EventPermissionReplied.from_dict(data)

                return componentsschemas_event_type_13
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_14 = EventSessionDiff.from_dict(data)

                return componentsschemas_event_type_14
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_15 = EventSessionError.from_dict(data)

                return componentsschemas_event_type_15
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_16 = EventQuestionAsked.from_dict(data)

                return componentsschemas_event_type_16
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_17 = EventQuestionReplied.from_dict(data)

                return componentsschemas_event_type_17
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_18 = EventQuestionRejected.from_dict(data)

                return componentsschemas_event_type_18
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_19 = EventTodoUpdated.from_dict(data)

                return componentsschemas_event_type_19
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_20 = EventSessionStatus.from_dict(data)

                return componentsschemas_event_type_20
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_21 = EventSessionIdle.from_dict(data)

                return componentsschemas_event_type_21
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_22 = EventMcpToolsChanged.from_dict(data)

                return componentsschemas_event_type_22
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_23 = EventMcpBrowserOpenFailed.from_dict(data)

                return componentsschemas_event_type_23
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_24 = EventCommandExecuted.from_dict(data)

                return componentsschemas_event_type_24
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_25 = EventProjectUpdated.from_dict(data)

                return componentsschemas_event_type_25
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_26 = EventSessionCompacted.from_dict(data)

                return componentsschemas_event_type_26
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_27 = EventVcsBranchUpdated.from_dict(data)

                return componentsschemas_event_type_27
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_28 = EventWorkspaceReady.from_dict(data)

                return componentsschemas_event_type_28
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_29 = EventWorkspaceFailed.from_dict(data)

                return componentsschemas_event_type_29
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_30 = EventWorkspaceStatus.from_dict(data)

                return componentsschemas_event_type_30
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_31 = EventWorktreeReady.from_dict(data)

                return componentsschemas_event_type_31
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_32 = EventWorktreeFailed.from_dict(data)

                return componentsschemas_event_type_32
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_33 = EventPtyCreated.from_dict(data)

                return componentsschemas_event_type_33
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_34 = EventPtyUpdated.from_dict(data)

                return componentsschemas_event_type_34
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_35 = EventPtyExited.from_dict(data)

                return componentsschemas_event_type_35
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_36 = EventPtyDeleted.from_dict(data)

                return componentsschemas_event_type_36
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_37 = EventInstallationUpdated.from_dict(data)

                return componentsschemas_event_type_37
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_38 = EventInstallationUpdateAvailable.from_dict(data)

                return componentsschemas_event_type_38
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_39 = EventMessageUpdated.from_dict(data)

                return componentsschemas_event_type_39
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_40 = EventMessageRemoved.from_dict(data)

                return componentsschemas_event_type_40
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_41 = EventMessagePartUpdated.from_dict(data)

                return componentsschemas_event_type_41
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_42 = EventMessagePartRemoved.from_dict(data)

                return componentsschemas_event_type_42
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_43 = EventSessionCreated.from_dict(data)

                return componentsschemas_event_type_43
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_44 = EventSessionUpdated.from_dict(data)

                return componentsschemas_event_type_44
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_45 = EventSessionDeleted.from_dict(data)

                return componentsschemas_event_type_45
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_46 = EventSessionNextAgentSwitched.from_dict(data)

                return componentsschemas_event_type_46
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_47 = EventSessionNextModelSwitched.from_dict(data)

                return componentsschemas_event_type_47
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_48 = EventSessionNextPrompted.from_dict(data)

                return componentsschemas_event_type_48
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_49 = EventSessionNextSynthetic.from_dict(data)

                return componentsschemas_event_type_49
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_50 = EventSessionNextShellStarted.from_dict(data)

                return componentsschemas_event_type_50
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_51 = EventSessionNextShellEnded.from_dict(data)

                return componentsschemas_event_type_51
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_52 = EventSessionNextStepStarted.from_dict(data)

                return componentsschemas_event_type_52
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_53 = EventSessionNextStepEnded.from_dict(data)

                return componentsschemas_event_type_53
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_54 = EventSessionNextStepFailed.from_dict(data)

                return componentsschemas_event_type_54
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_55 = EventSessionNextTextStarted.from_dict(data)

                return componentsschemas_event_type_55
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_56 = EventSessionNextTextDelta.from_dict(data)

                return componentsschemas_event_type_56
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_57 = EventSessionNextTextEnded.from_dict(data)

                return componentsschemas_event_type_57
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_58 = EventSessionNextReasoningStarted.from_dict(data)

                return componentsschemas_event_type_58
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_59 = EventSessionNextReasoningDelta.from_dict(data)

                return componentsschemas_event_type_59
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_60 = EventSessionNextReasoningEnded.from_dict(data)

                return componentsschemas_event_type_60
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_61 = EventSessionNextToolInputStarted.from_dict(data)

                return componentsschemas_event_type_61
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_62 = EventSessionNextToolInputDelta.from_dict(data)

                return componentsschemas_event_type_62
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_63 = EventSessionNextToolInputEnded.from_dict(data)

                return componentsschemas_event_type_63
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_64 = EventSessionNextToolCalled.from_dict(data)

                return componentsschemas_event_type_64
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_65 = EventSessionNextToolProgress.from_dict(data)

                return componentsschemas_event_type_65
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_66 = EventSessionNextToolSuccess.from_dict(data)

                return componentsschemas_event_type_66
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_67 = EventSessionNextToolFailed.from_dict(data)

                return componentsschemas_event_type_67
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_68 = EventSessionNextRetried.from_dict(data)

                return componentsschemas_event_type_68
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_69 = EventSessionNextCompactionStarted.from_dict(data)

                return componentsschemas_event_type_69
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_70 = EventSessionNextCompactionDelta.from_dict(data)

                return componentsschemas_event_type_70
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_71 = EventSessionNextCompactionEnded.from_dict(data)

                return componentsschemas_event_type_71
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_72 = EventCatalogModelUpdated.from_dict(data)

                return componentsschemas_event_type_72
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_99 = EventModelsDevRefreshed.from_dict(data)

                return componentsschemas_event_type_99
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_100 = EventAccountAdded.from_dict(data)

                return componentsschemas_event_type_100
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_event_type_101 = EventAccountRemoved.from_dict(data)

                return componentsschemas_event_type_101
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            componentsschemas_event_type_102 = EventAccountSwitched.from_dict(data)

            return componentsschemas_event_type_102

        response_200 = _parse_response_200(response.text)

        return response_200

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    EventAccountAdded
    | EventAccountRemoved
    | EventAccountSwitched
    | EventCatalogModelUpdated
    | EventCommandExecuted
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
    | EventModelsDevRefreshed
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
    | EventSessionNextAgentSwitched
    | EventSessionNextCompactionDelta
    | EventSessionNextCompactionEnded
    | EventSessionNextCompactionStarted
    | EventSessionNextModelSwitched
    | EventSessionNextPrompted
    | EventSessionNextReasoningDelta
    | EventSessionNextReasoningEnded
    | EventSessionNextReasoningStarted
    | EventSessionNextRetried
    | EventSessionNextShellEnded
    | EventSessionNextShellStarted
    | EventSessionNextStepEnded
    | EventSessionNextStepFailed
    | EventSessionNextStepStarted
    | EventSessionNextSynthetic
    | EventSessionNextTextDelta
    | EventSessionNextTextEnded
    | EventSessionNextTextStarted
    | EventSessionNextToolCalled
    | EventSessionNextToolFailed
    | EventSessionNextToolInputDelta
    | EventSessionNextToolInputEnded
    | EventSessionNextToolInputStarted
    | EventSessionNextToolProgress
    | EventSessionNextToolSuccess
    | EventSessionStatus
    | EventSessionUpdated
    | EventTodoUpdated
    | EventTuiCommandExecute
    | EventTuiPromptAppend
    | EventTuiSessionSelect
    | EventTuiToastShow1
    | EventVcsBranchUpdated
    | EventWorkspaceFailed
    | EventWorkspaceReady
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
    EventAccountAdded
    | EventAccountRemoved
    | EventAccountSwitched
    | EventCatalogModelUpdated
    | EventCommandExecuted
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
    | EventModelsDevRefreshed
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
    | EventSessionNextAgentSwitched
    | EventSessionNextCompactionDelta
    | EventSessionNextCompactionEnded
    | EventSessionNextCompactionStarted
    | EventSessionNextModelSwitched
    | EventSessionNextPrompted
    | EventSessionNextReasoningDelta
    | EventSessionNextReasoningEnded
    | EventSessionNextReasoningStarted
    | EventSessionNextRetried
    | EventSessionNextShellEnded
    | EventSessionNextShellStarted
    | EventSessionNextStepEnded
    | EventSessionNextStepFailed
    | EventSessionNextStepStarted
    | EventSessionNextSynthetic
    | EventSessionNextTextDelta
    | EventSessionNextTextEnded
    | EventSessionNextTextStarted
    | EventSessionNextToolCalled
    | EventSessionNextToolFailed
    | EventSessionNextToolInputDelta
    | EventSessionNextToolInputEnded
    | EventSessionNextToolInputStarted
    | EventSessionNextToolProgress
    | EventSessionNextToolSuccess
    | EventSessionStatus
    | EventSessionUpdated
    | EventTodoUpdated
    | EventTuiCommandExecute
    | EventTuiPromptAppend
    | EventTuiSessionSelect
    | EventTuiToastShow1
    | EventVcsBranchUpdated
    | EventWorkspaceFailed
    | EventWorkspaceReady
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
        Response[EventAccountAdded | EventAccountRemoved | EventAccountSwitched | EventCatalogModelUpdated | EventCommandExecuted | EventFileEdited | EventFileWatcherUpdated | EventGlobalDisposed | EventInstallationUpdateAvailable | EventInstallationUpdated | EventLspClientDiagnostics | EventLspUpdated | EventMcpBrowserOpenFailed | EventMcpToolsChanged | EventMessagePartDelta | EventMessagePartRemoved | EventMessagePartUpdated | EventMessageRemoved | EventMessageUpdated | EventModelsDevRefreshed | EventPermissionAsked | EventPermissionReplied | EventProjectUpdated | EventPtyCreated | EventPtyDeleted | EventPtyExited | EventPtyUpdated | EventQuestionAsked | EventQuestionRejected | EventQuestionReplied | EventServerConnected | EventServerInstanceDisposed | EventSessionCompacted | EventSessionCreated | EventSessionDeleted | EventSessionDiff | EventSessionError | EventSessionIdle | EventSessionNextAgentSwitched | EventSessionNextCompactionDelta | EventSessionNextCompactionEnded | EventSessionNextCompactionStarted | EventSessionNextModelSwitched | EventSessionNextPrompted | EventSessionNextReasoningDelta | EventSessionNextReasoningEnded | EventSessionNextReasoningStarted | EventSessionNextRetried | EventSessionNextShellEnded | EventSessionNextShellStarted | EventSessionNextStepEnded | EventSessionNextStepFailed | EventSessionNextStepStarted | EventSessionNextSynthetic | EventSessionNextTextDelta | EventSessionNextTextEnded | EventSessionNextTextStarted | EventSessionNextToolCalled | EventSessionNextToolFailed | EventSessionNextToolInputDelta | EventSessionNextToolInputEnded | EventSessionNextToolInputStarted | EventSessionNextToolProgress | EventSessionNextToolSuccess | EventSessionStatus | EventSessionUpdated | EventTodoUpdated | EventTuiCommandExecute | EventTuiPromptAppend | EventTuiSessionSelect | EventTuiToastShow1 | EventVcsBranchUpdated | EventWorkspaceFailed | EventWorkspaceReady | EventWorkspaceStatus | EventWorktreeFailed | EventWorktreeReady]
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
    EventAccountAdded
    | EventAccountRemoved
    | EventAccountSwitched
    | EventCatalogModelUpdated
    | EventCommandExecuted
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
    | EventModelsDevRefreshed
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
    | EventSessionNextAgentSwitched
    | EventSessionNextCompactionDelta
    | EventSessionNextCompactionEnded
    | EventSessionNextCompactionStarted
    | EventSessionNextModelSwitched
    | EventSessionNextPrompted
    | EventSessionNextReasoningDelta
    | EventSessionNextReasoningEnded
    | EventSessionNextReasoningStarted
    | EventSessionNextRetried
    | EventSessionNextShellEnded
    | EventSessionNextShellStarted
    | EventSessionNextStepEnded
    | EventSessionNextStepFailed
    | EventSessionNextStepStarted
    | EventSessionNextSynthetic
    | EventSessionNextTextDelta
    | EventSessionNextTextEnded
    | EventSessionNextTextStarted
    | EventSessionNextToolCalled
    | EventSessionNextToolFailed
    | EventSessionNextToolInputDelta
    | EventSessionNextToolInputEnded
    | EventSessionNextToolInputStarted
    | EventSessionNextToolProgress
    | EventSessionNextToolSuccess
    | EventSessionStatus
    | EventSessionUpdated
    | EventTodoUpdated
    | EventTuiCommandExecute
    | EventTuiPromptAppend
    | EventTuiSessionSelect
    | EventTuiToastShow1
    | EventVcsBranchUpdated
    | EventWorkspaceFailed
    | EventWorkspaceReady
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
        EventAccountAdded | EventAccountRemoved | EventAccountSwitched | EventCatalogModelUpdated | EventCommandExecuted | EventFileEdited | EventFileWatcherUpdated | EventGlobalDisposed | EventInstallationUpdateAvailable | EventInstallationUpdated | EventLspClientDiagnostics | EventLspUpdated | EventMcpBrowserOpenFailed | EventMcpToolsChanged | EventMessagePartDelta | EventMessagePartRemoved | EventMessagePartUpdated | EventMessageRemoved | EventMessageUpdated | EventModelsDevRefreshed | EventPermissionAsked | EventPermissionReplied | EventProjectUpdated | EventPtyCreated | EventPtyDeleted | EventPtyExited | EventPtyUpdated | EventQuestionAsked | EventQuestionRejected | EventQuestionReplied | EventServerConnected | EventServerInstanceDisposed | EventSessionCompacted | EventSessionCreated | EventSessionDeleted | EventSessionDiff | EventSessionError | EventSessionIdle | EventSessionNextAgentSwitched | EventSessionNextCompactionDelta | EventSessionNextCompactionEnded | EventSessionNextCompactionStarted | EventSessionNextModelSwitched | EventSessionNextPrompted | EventSessionNextReasoningDelta | EventSessionNextReasoningEnded | EventSessionNextReasoningStarted | EventSessionNextRetried | EventSessionNextShellEnded | EventSessionNextShellStarted | EventSessionNextStepEnded | EventSessionNextStepFailed | EventSessionNextStepStarted | EventSessionNextSynthetic | EventSessionNextTextDelta | EventSessionNextTextEnded | EventSessionNextTextStarted | EventSessionNextToolCalled | EventSessionNextToolFailed | EventSessionNextToolInputDelta | EventSessionNextToolInputEnded | EventSessionNextToolInputStarted | EventSessionNextToolProgress | EventSessionNextToolSuccess | EventSessionStatus | EventSessionUpdated | EventTodoUpdated | EventTuiCommandExecute | EventTuiPromptAppend | EventTuiSessionSelect | EventTuiToastShow1 | EventVcsBranchUpdated | EventWorkspaceFailed | EventWorkspaceReady | EventWorkspaceStatus | EventWorktreeFailed | EventWorktreeReady
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
    EventAccountAdded
    | EventAccountRemoved
    | EventAccountSwitched
    | EventCatalogModelUpdated
    | EventCommandExecuted
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
    | EventModelsDevRefreshed
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
    | EventSessionNextAgentSwitched
    | EventSessionNextCompactionDelta
    | EventSessionNextCompactionEnded
    | EventSessionNextCompactionStarted
    | EventSessionNextModelSwitched
    | EventSessionNextPrompted
    | EventSessionNextReasoningDelta
    | EventSessionNextReasoningEnded
    | EventSessionNextReasoningStarted
    | EventSessionNextRetried
    | EventSessionNextShellEnded
    | EventSessionNextShellStarted
    | EventSessionNextStepEnded
    | EventSessionNextStepFailed
    | EventSessionNextStepStarted
    | EventSessionNextSynthetic
    | EventSessionNextTextDelta
    | EventSessionNextTextEnded
    | EventSessionNextTextStarted
    | EventSessionNextToolCalled
    | EventSessionNextToolFailed
    | EventSessionNextToolInputDelta
    | EventSessionNextToolInputEnded
    | EventSessionNextToolInputStarted
    | EventSessionNextToolProgress
    | EventSessionNextToolSuccess
    | EventSessionStatus
    | EventSessionUpdated
    | EventTodoUpdated
    | EventTuiCommandExecute
    | EventTuiPromptAppend
    | EventTuiSessionSelect
    | EventTuiToastShow1
    | EventVcsBranchUpdated
    | EventWorkspaceFailed
    | EventWorkspaceReady
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
        Response[EventAccountAdded | EventAccountRemoved | EventAccountSwitched | EventCatalogModelUpdated | EventCommandExecuted | EventFileEdited | EventFileWatcherUpdated | EventGlobalDisposed | EventInstallationUpdateAvailable | EventInstallationUpdated | EventLspClientDiagnostics | EventLspUpdated | EventMcpBrowserOpenFailed | EventMcpToolsChanged | EventMessagePartDelta | EventMessagePartRemoved | EventMessagePartUpdated | EventMessageRemoved | EventMessageUpdated | EventModelsDevRefreshed | EventPermissionAsked | EventPermissionReplied | EventProjectUpdated | EventPtyCreated | EventPtyDeleted | EventPtyExited | EventPtyUpdated | EventQuestionAsked | EventQuestionRejected | EventQuestionReplied | EventServerConnected | EventServerInstanceDisposed | EventSessionCompacted | EventSessionCreated | EventSessionDeleted | EventSessionDiff | EventSessionError | EventSessionIdle | EventSessionNextAgentSwitched | EventSessionNextCompactionDelta | EventSessionNextCompactionEnded | EventSessionNextCompactionStarted | EventSessionNextModelSwitched | EventSessionNextPrompted | EventSessionNextReasoningDelta | EventSessionNextReasoningEnded | EventSessionNextReasoningStarted | EventSessionNextRetried | EventSessionNextShellEnded | EventSessionNextShellStarted | EventSessionNextStepEnded | EventSessionNextStepFailed | EventSessionNextStepStarted | EventSessionNextSynthetic | EventSessionNextTextDelta | EventSessionNextTextEnded | EventSessionNextTextStarted | EventSessionNextToolCalled | EventSessionNextToolFailed | EventSessionNextToolInputDelta | EventSessionNextToolInputEnded | EventSessionNextToolInputStarted | EventSessionNextToolProgress | EventSessionNextToolSuccess | EventSessionStatus | EventSessionUpdated | EventTodoUpdated | EventTuiCommandExecute | EventTuiPromptAppend | EventTuiSessionSelect | EventTuiToastShow1 | EventVcsBranchUpdated | EventWorkspaceFailed | EventWorkspaceReady | EventWorkspaceStatus | EventWorktreeFailed | EventWorktreeReady]
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
    EventAccountAdded
    | EventAccountRemoved
    | EventAccountSwitched
    | EventCatalogModelUpdated
    | EventCommandExecuted
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
    | EventModelsDevRefreshed
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
    | EventSessionNextAgentSwitched
    | EventSessionNextCompactionDelta
    | EventSessionNextCompactionEnded
    | EventSessionNextCompactionStarted
    | EventSessionNextModelSwitched
    | EventSessionNextPrompted
    | EventSessionNextReasoningDelta
    | EventSessionNextReasoningEnded
    | EventSessionNextReasoningStarted
    | EventSessionNextRetried
    | EventSessionNextShellEnded
    | EventSessionNextShellStarted
    | EventSessionNextStepEnded
    | EventSessionNextStepFailed
    | EventSessionNextStepStarted
    | EventSessionNextSynthetic
    | EventSessionNextTextDelta
    | EventSessionNextTextEnded
    | EventSessionNextTextStarted
    | EventSessionNextToolCalled
    | EventSessionNextToolFailed
    | EventSessionNextToolInputDelta
    | EventSessionNextToolInputEnded
    | EventSessionNextToolInputStarted
    | EventSessionNextToolProgress
    | EventSessionNextToolSuccess
    | EventSessionStatus
    | EventSessionUpdated
    | EventTodoUpdated
    | EventTuiCommandExecute
    | EventTuiPromptAppend
    | EventTuiSessionSelect
    | EventTuiToastShow1
    | EventVcsBranchUpdated
    | EventWorkspaceFailed
    | EventWorkspaceReady
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
        EventAccountAdded | EventAccountRemoved | EventAccountSwitched | EventCatalogModelUpdated | EventCommandExecuted | EventFileEdited | EventFileWatcherUpdated | EventGlobalDisposed | EventInstallationUpdateAvailable | EventInstallationUpdated | EventLspClientDiagnostics | EventLspUpdated | EventMcpBrowserOpenFailed | EventMcpToolsChanged | EventMessagePartDelta | EventMessagePartRemoved | EventMessagePartUpdated | EventMessageRemoved | EventMessageUpdated | EventModelsDevRefreshed | EventPermissionAsked | EventPermissionReplied | EventProjectUpdated | EventPtyCreated | EventPtyDeleted | EventPtyExited | EventPtyUpdated | EventQuestionAsked | EventQuestionRejected | EventQuestionReplied | EventServerConnected | EventServerInstanceDisposed | EventSessionCompacted | EventSessionCreated | EventSessionDeleted | EventSessionDiff | EventSessionError | EventSessionIdle | EventSessionNextAgentSwitched | EventSessionNextCompactionDelta | EventSessionNextCompactionEnded | EventSessionNextCompactionStarted | EventSessionNextModelSwitched | EventSessionNextPrompted | EventSessionNextReasoningDelta | EventSessionNextReasoningEnded | EventSessionNextReasoningStarted | EventSessionNextRetried | EventSessionNextShellEnded | EventSessionNextShellStarted | EventSessionNextStepEnded | EventSessionNextStepFailed | EventSessionNextStepStarted | EventSessionNextSynthetic | EventSessionNextTextDelta | EventSessionNextTextEnded | EventSessionNextTextStarted | EventSessionNextToolCalled | EventSessionNextToolFailed | EventSessionNextToolInputDelta | EventSessionNextToolInputEnded | EventSessionNextToolInputStarted | EventSessionNextToolProgress | EventSessionNextToolSuccess | EventSessionStatus | EventSessionUpdated | EventTodoUpdated | EventTuiCommandExecute | EventTuiPromptAppend | EventTuiSessionSelect | EventTuiToastShow1 | EventVcsBranchUpdated | EventWorkspaceFailed | EventWorkspaceReady | EventWorkspaceStatus | EventWorktreeFailed | EventWorktreeReady
    """

    return (
        await asyncio_detailed(
            client=client,
            directory=directory,
            workspace=workspace,
        )
    ).parsed
