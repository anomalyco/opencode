from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.event_account_added import EventAccountAdded
    from ..models.event_account_removed import EventAccountRemoved
    from ..models.event_account_switched import EventAccountSwitched
    from ..models.event_catalog_model_updated import EventCatalogModelUpdated
    from ..models.event_command_executed import EventCommandExecuted
    from ..models.event_file_edited import EventFileEdited
    from ..models.event_file_watcher_updated import EventFileWatcherUpdated
    from ..models.event_global_disposed import EventGlobalDisposed
    from ..models.event_installation_update_available import EventInstallationUpdateAvailable
    from ..models.event_installation_updated import EventInstallationUpdated
    from ..models.event_lsp_client_diagnostics import EventLspClientDiagnostics
    from ..models.event_lsp_updated import EventLspUpdated
    from ..models.event_mcp_browser_open_failed import EventMcpBrowserOpenFailed
    from ..models.event_mcp_tools_changed import EventMcpToolsChanged
    from ..models.event_message_part_delta import EventMessagePartDelta
    from ..models.event_message_part_removed import EventMessagePartRemoved
    from ..models.event_message_part_updated import EventMessagePartUpdated
    from ..models.event_message_removed import EventMessageRemoved
    from ..models.event_message_updated import EventMessageUpdated
    from ..models.event_models_dev_refreshed import EventModelsDevRefreshed
    from ..models.event_permission_asked import EventPermissionAsked
    from ..models.event_permission_replied import EventPermissionReplied
    from ..models.event_project_updated import EventProjectUpdated
    from ..models.event_pty_created import EventPtyCreated
    from ..models.event_pty_deleted import EventPtyDeleted
    from ..models.event_pty_exited import EventPtyExited
    from ..models.event_pty_updated import EventPtyUpdated
    from ..models.event_question_asked import EventQuestionAsked
    from ..models.event_question_rejected import EventQuestionRejected
    from ..models.event_question_replied import EventQuestionReplied
    from ..models.event_server_connected import EventServerConnected
    from ..models.event_server_instance_disposed import EventServerInstanceDisposed
    from ..models.event_session_compacted import EventSessionCompacted
    from ..models.event_session_created import EventSessionCreated
    from ..models.event_session_deleted import EventSessionDeleted
    from ..models.event_session_diff import EventSessionDiff
    from ..models.event_session_error import EventSessionError
    from ..models.event_session_idle import EventSessionIdle
    from ..models.event_session_next_agent_switched import EventSessionNextAgentSwitched
    from ..models.event_session_next_compaction_delta import EventSessionNextCompactionDelta
    from ..models.event_session_next_compaction_ended import EventSessionNextCompactionEnded
    from ..models.event_session_next_compaction_started import EventSessionNextCompactionStarted
    from ..models.event_session_next_model_switched import EventSessionNextModelSwitched
    from ..models.event_session_next_prompted import EventSessionNextPrompted
    from ..models.event_session_next_reasoning_delta import EventSessionNextReasoningDelta
    from ..models.event_session_next_reasoning_ended import EventSessionNextReasoningEnded
    from ..models.event_session_next_reasoning_started import EventSessionNextReasoningStarted
    from ..models.event_session_next_retried import EventSessionNextRetried
    from ..models.event_session_next_shell_ended import EventSessionNextShellEnded
    from ..models.event_session_next_shell_started import EventSessionNextShellStarted
    from ..models.event_session_next_step_ended import EventSessionNextStepEnded
    from ..models.event_session_next_step_failed import EventSessionNextStepFailed
    from ..models.event_session_next_step_started import EventSessionNextStepStarted
    from ..models.event_session_next_synthetic import EventSessionNextSynthetic
    from ..models.event_session_next_text_delta import EventSessionNextTextDelta
    from ..models.event_session_next_text_ended import EventSessionNextTextEnded
    from ..models.event_session_next_text_started import EventSessionNextTextStarted
    from ..models.event_session_next_tool_called import EventSessionNextToolCalled
    from ..models.event_session_next_tool_failed import EventSessionNextToolFailed
    from ..models.event_session_next_tool_input_delta import EventSessionNextToolInputDelta
    from ..models.event_session_next_tool_input_ended import EventSessionNextToolInputEnded
    from ..models.event_session_next_tool_input_started import EventSessionNextToolInputStarted
    from ..models.event_session_next_tool_progress import EventSessionNextToolProgress
    from ..models.event_session_next_tool_success import EventSessionNextToolSuccess
    from ..models.event_session_status import EventSessionStatus
    from ..models.event_session_updated import EventSessionUpdated
    from ..models.event_todo_updated import EventTodoUpdated
    from ..models.event_tui_command_execute import EventTuiCommandExecute
    from ..models.event_tui_prompt_append import EventTuiPromptAppend
    from ..models.event_tui_session_select import EventTuiSessionSelect
    from ..models.event_tui_toast_show import EventTuiToastShow
    from ..models.event_vcs_branch_updated import EventVcsBranchUpdated
    from ..models.event_workspace_failed import EventWorkspaceFailed
    from ..models.event_workspace_ready import EventWorkspaceReady
    from ..models.event_workspace_status import EventWorkspaceStatus
    from ..models.event_worktree_failed import EventWorktreeFailed
    from ..models.event_worktree_ready import EventWorktreeReady
    from ..models.sync_event_message_part_removed import SyncEventMessagePartRemoved
    from ..models.sync_event_message_part_updated import SyncEventMessagePartUpdated
    from ..models.sync_event_message_removed import SyncEventMessageRemoved
    from ..models.sync_event_message_updated import SyncEventMessageUpdated
    from ..models.sync_event_session_created import SyncEventSessionCreated
    from ..models.sync_event_session_deleted import SyncEventSessionDeleted
    from ..models.sync_event_session_next_agent_switched import SyncEventSessionNextAgentSwitched
    from ..models.sync_event_session_next_compaction_delta import SyncEventSessionNextCompactionDelta
    from ..models.sync_event_session_next_compaction_ended import SyncEventSessionNextCompactionEnded
    from ..models.sync_event_session_next_compaction_started import SyncEventSessionNextCompactionStarted
    from ..models.sync_event_session_next_model_switched import SyncEventSessionNextModelSwitched
    from ..models.sync_event_session_next_prompted import SyncEventSessionNextPrompted
    from ..models.sync_event_session_next_reasoning_delta import SyncEventSessionNextReasoningDelta
    from ..models.sync_event_session_next_reasoning_ended import SyncEventSessionNextReasoningEnded
    from ..models.sync_event_session_next_reasoning_started import SyncEventSessionNextReasoningStarted
    from ..models.sync_event_session_next_retried import SyncEventSessionNextRetried
    from ..models.sync_event_session_next_shell_ended import SyncEventSessionNextShellEnded
    from ..models.sync_event_session_next_shell_started import SyncEventSessionNextShellStarted
    from ..models.sync_event_session_next_step_ended import SyncEventSessionNextStepEnded
    from ..models.sync_event_session_next_step_failed import SyncEventSessionNextStepFailed
    from ..models.sync_event_session_next_step_started import SyncEventSessionNextStepStarted
    from ..models.sync_event_session_next_synthetic import SyncEventSessionNextSynthetic
    from ..models.sync_event_session_next_text_delta import SyncEventSessionNextTextDelta
    from ..models.sync_event_session_next_text_ended import SyncEventSessionNextTextEnded
    from ..models.sync_event_session_next_text_started import SyncEventSessionNextTextStarted
    from ..models.sync_event_session_next_tool_called import SyncEventSessionNextToolCalled
    from ..models.sync_event_session_next_tool_failed import SyncEventSessionNextToolFailed
    from ..models.sync_event_session_next_tool_input_delta import SyncEventSessionNextToolInputDelta
    from ..models.sync_event_session_next_tool_input_ended import SyncEventSessionNextToolInputEnded
    from ..models.sync_event_session_next_tool_input_started import SyncEventSessionNextToolInputStarted
    from ..models.sync_event_session_next_tool_progress import SyncEventSessionNextToolProgress
    from ..models.sync_event_session_next_tool_success import SyncEventSessionNextToolSuccess
    from ..models.sync_event_session_updated import SyncEventSessionUpdated


T = TypeVar("T", bound="GlobalEvent")


@_attrs_define
class GlobalEvent:
    """
    Attributes:
        directory (str):
        payload (EventAccountAdded | EventAccountRemoved | EventAccountSwitched | EventCatalogModelUpdated |
            EventCommandExecuted | EventFileEdited | EventFileWatcherUpdated | EventGlobalDisposed |
            EventInstallationUpdateAvailable | EventInstallationUpdated | EventLspClientDiagnostics | EventLspUpdated |
            EventMcpBrowserOpenFailed | EventMcpToolsChanged | EventMessagePartDelta | EventMessagePartRemoved |
            EventMessagePartUpdated | EventMessageRemoved | EventMessageUpdated | EventModelsDevRefreshed |
            EventPermissionAsked | EventPermissionReplied | EventProjectUpdated | EventPtyCreated | EventPtyDeleted |
            EventPtyExited | EventPtyUpdated | EventQuestionAsked | EventQuestionRejected | EventQuestionReplied |
            EventServerConnected | EventServerInstanceDisposed | EventSessionCompacted | EventSessionCreated |
            EventSessionDeleted | EventSessionDiff | EventSessionError | EventSessionIdle | EventSessionNextAgentSwitched |
            EventSessionNextCompactionDelta | EventSessionNextCompactionEnded | EventSessionNextCompactionStarted |
            EventSessionNextModelSwitched | EventSessionNextPrompted | EventSessionNextReasoningDelta |
            EventSessionNextReasoningEnded | EventSessionNextReasoningStarted | EventSessionNextRetried |
            EventSessionNextShellEnded | EventSessionNextShellStarted | EventSessionNextStepEnded |
            EventSessionNextStepFailed | EventSessionNextStepStarted | EventSessionNextSynthetic | EventSessionNextTextDelta
            | EventSessionNextTextEnded | EventSessionNextTextStarted | EventSessionNextToolCalled |
            EventSessionNextToolFailed | EventSessionNextToolInputDelta | EventSessionNextToolInputEnded |
            EventSessionNextToolInputStarted | EventSessionNextToolProgress | EventSessionNextToolSuccess |
            EventSessionStatus | EventSessionUpdated | EventTodoUpdated | EventTuiCommandExecute | EventTuiPromptAppend |
            EventTuiSessionSelect | EventTuiToastShow | EventVcsBranchUpdated | EventWorkspaceFailed | EventWorkspaceReady |
            EventWorkspaceStatus | EventWorktreeFailed | EventWorktreeReady | SyncEventMessagePartRemoved |
            SyncEventMessagePartUpdated | SyncEventMessageRemoved | SyncEventMessageUpdated | SyncEventSessionCreated |
            SyncEventSessionDeleted | SyncEventSessionNextAgentSwitched | SyncEventSessionNextCompactionDelta |
            SyncEventSessionNextCompactionEnded | SyncEventSessionNextCompactionStarted | SyncEventSessionNextModelSwitched
            | SyncEventSessionNextPrompted | SyncEventSessionNextReasoningDelta | SyncEventSessionNextReasoningEnded |
            SyncEventSessionNextReasoningStarted | SyncEventSessionNextRetried | SyncEventSessionNextShellEnded |
            SyncEventSessionNextShellStarted | SyncEventSessionNextStepEnded | SyncEventSessionNextStepFailed |
            SyncEventSessionNextStepStarted | SyncEventSessionNextSynthetic | SyncEventSessionNextTextDelta |
            SyncEventSessionNextTextEnded | SyncEventSessionNextTextStarted | SyncEventSessionNextToolCalled |
            SyncEventSessionNextToolFailed | SyncEventSessionNextToolInputDelta | SyncEventSessionNextToolInputEnded |
            SyncEventSessionNextToolInputStarted | SyncEventSessionNextToolProgress | SyncEventSessionNextToolSuccess |
            SyncEventSessionUpdated):
        project (str | Unset):
        workspace (str | Unset):
    """

    directory: str
    payload: (
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
        | EventTuiToastShow
        | EventVcsBranchUpdated
        | EventWorkspaceFailed
        | EventWorkspaceReady
        | EventWorkspaceStatus
        | EventWorktreeFailed
        | EventWorktreeReady
        | SyncEventMessagePartRemoved
        | SyncEventMessagePartUpdated
        | SyncEventMessageRemoved
        | SyncEventMessageUpdated
        | SyncEventSessionCreated
        | SyncEventSessionDeleted
        | SyncEventSessionNextAgentSwitched
        | SyncEventSessionNextCompactionDelta
        | SyncEventSessionNextCompactionEnded
        | SyncEventSessionNextCompactionStarted
        | SyncEventSessionNextModelSwitched
        | SyncEventSessionNextPrompted
        | SyncEventSessionNextReasoningDelta
        | SyncEventSessionNextReasoningEnded
        | SyncEventSessionNextReasoningStarted
        | SyncEventSessionNextRetried
        | SyncEventSessionNextShellEnded
        | SyncEventSessionNextShellStarted
        | SyncEventSessionNextStepEnded
        | SyncEventSessionNextStepFailed
        | SyncEventSessionNextStepStarted
        | SyncEventSessionNextSynthetic
        | SyncEventSessionNextTextDelta
        | SyncEventSessionNextTextEnded
        | SyncEventSessionNextTextStarted
        | SyncEventSessionNextToolCalled
        | SyncEventSessionNextToolFailed
        | SyncEventSessionNextToolInputDelta
        | SyncEventSessionNextToolInputEnded
        | SyncEventSessionNextToolInputStarted
        | SyncEventSessionNextToolProgress
        | SyncEventSessionNextToolSuccess
        | SyncEventSessionUpdated
    )
    project: str | Unset = UNSET
    workspace: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        from ..models.event_account_added import EventAccountAdded
        from ..models.event_account_removed import EventAccountRemoved
        from ..models.event_account_switched import EventAccountSwitched
        from ..models.event_catalog_model_updated import EventCatalogModelUpdated
        from ..models.event_command_executed import EventCommandExecuted
        from ..models.event_file_edited import EventFileEdited
        from ..models.event_file_watcher_updated import EventFileWatcherUpdated
        from ..models.event_global_disposed import EventGlobalDisposed
        from ..models.event_installation_update_available import EventInstallationUpdateAvailable
        from ..models.event_installation_updated import EventInstallationUpdated
        from ..models.event_lsp_client_diagnostics import EventLspClientDiagnostics
        from ..models.event_lsp_updated import EventLspUpdated
        from ..models.event_mcp_browser_open_failed import EventMcpBrowserOpenFailed
        from ..models.event_mcp_tools_changed import EventMcpToolsChanged
        from ..models.event_message_part_delta import EventMessagePartDelta
        from ..models.event_message_part_removed import EventMessagePartRemoved
        from ..models.event_message_part_updated import EventMessagePartUpdated
        from ..models.event_message_removed import EventMessageRemoved
        from ..models.event_message_updated import EventMessageUpdated
        from ..models.event_models_dev_refreshed import EventModelsDevRefreshed
        from ..models.event_permission_asked import EventPermissionAsked
        from ..models.event_permission_replied import EventPermissionReplied
        from ..models.event_project_updated import EventProjectUpdated
        from ..models.event_pty_created import EventPtyCreated
        from ..models.event_pty_deleted import EventPtyDeleted
        from ..models.event_pty_exited import EventPtyExited
        from ..models.event_pty_updated import EventPtyUpdated
        from ..models.event_question_asked import EventQuestionAsked
        from ..models.event_question_rejected import EventQuestionRejected
        from ..models.event_question_replied import EventQuestionReplied
        from ..models.event_server_connected import EventServerConnected
        from ..models.event_server_instance_disposed import EventServerInstanceDisposed
        from ..models.event_session_compacted import EventSessionCompacted
        from ..models.event_session_created import EventSessionCreated
        from ..models.event_session_deleted import EventSessionDeleted
        from ..models.event_session_diff import EventSessionDiff
        from ..models.event_session_error import EventSessionError
        from ..models.event_session_idle import EventSessionIdle
        from ..models.event_session_next_agent_switched import EventSessionNextAgentSwitched
        from ..models.event_session_next_compaction_delta import EventSessionNextCompactionDelta
        from ..models.event_session_next_compaction_ended import EventSessionNextCompactionEnded
        from ..models.event_session_next_compaction_started import EventSessionNextCompactionStarted
        from ..models.event_session_next_model_switched import EventSessionNextModelSwitched
        from ..models.event_session_next_prompted import EventSessionNextPrompted
        from ..models.event_session_next_reasoning_delta import EventSessionNextReasoningDelta
        from ..models.event_session_next_reasoning_ended import EventSessionNextReasoningEnded
        from ..models.event_session_next_reasoning_started import EventSessionNextReasoningStarted
        from ..models.event_session_next_retried import EventSessionNextRetried
        from ..models.event_session_next_shell_ended import EventSessionNextShellEnded
        from ..models.event_session_next_shell_started import EventSessionNextShellStarted
        from ..models.event_session_next_step_ended import EventSessionNextStepEnded
        from ..models.event_session_next_step_failed import EventSessionNextStepFailed
        from ..models.event_session_next_step_started import EventSessionNextStepStarted
        from ..models.event_session_next_synthetic import EventSessionNextSynthetic
        from ..models.event_session_next_text_delta import EventSessionNextTextDelta
        from ..models.event_session_next_text_ended import EventSessionNextTextEnded
        from ..models.event_session_next_text_started import EventSessionNextTextStarted
        from ..models.event_session_next_tool_called import EventSessionNextToolCalled
        from ..models.event_session_next_tool_failed import EventSessionNextToolFailed
        from ..models.event_session_next_tool_input_delta import EventSessionNextToolInputDelta
        from ..models.event_session_next_tool_input_ended import EventSessionNextToolInputEnded
        from ..models.event_session_next_tool_input_started import EventSessionNextToolInputStarted
        from ..models.event_session_next_tool_progress import EventSessionNextToolProgress
        from ..models.event_session_next_tool_success import EventSessionNextToolSuccess
        from ..models.event_session_status import EventSessionStatus
        from ..models.event_session_updated import EventSessionUpdated
        from ..models.event_todo_updated import EventTodoUpdated
        from ..models.event_tui_command_execute import EventTuiCommandExecute
        from ..models.event_tui_prompt_append import EventTuiPromptAppend
        from ..models.event_tui_session_select import EventTuiSessionSelect
        from ..models.event_tui_toast_show import EventTuiToastShow
        from ..models.event_vcs_branch_updated import EventVcsBranchUpdated
        from ..models.event_workspace_failed import EventWorkspaceFailed
        from ..models.event_workspace_ready import EventWorkspaceReady
        from ..models.event_workspace_status import EventWorkspaceStatus
        from ..models.event_worktree_failed import EventWorktreeFailed
        from ..models.event_worktree_ready import EventWorktreeReady
        from ..models.sync_event_message_part_removed import SyncEventMessagePartRemoved
        from ..models.sync_event_message_part_updated import SyncEventMessagePartUpdated
        from ..models.sync_event_message_removed import SyncEventMessageRemoved
        from ..models.sync_event_message_updated import SyncEventMessageUpdated
        from ..models.sync_event_session_created import SyncEventSessionCreated
        from ..models.sync_event_session_deleted import SyncEventSessionDeleted
        from ..models.sync_event_session_next_agent_switched import SyncEventSessionNextAgentSwitched
        from ..models.sync_event_session_next_compaction_delta import SyncEventSessionNextCompactionDelta
        from ..models.sync_event_session_next_compaction_started import SyncEventSessionNextCompactionStarted
        from ..models.sync_event_session_next_model_switched import SyncEventSessionNextModelSwitched
        from ..models.sync_event_session_next_prompted import SyncEventSessionNextPrompted
        from ..models.sync_event_session_next_reasoning_delta import SyncEventSessionNextReasoningDelta
        from ..models.sync_event_session_next_reasoning_ended import SyncEventSessionNextReasoningEnded
        from ..models.sync_event_session_next_reasoning_started import SyncEventSessionNextReasoningStarted
        from ..models.sync_event_session_next_retried import SyncEventSessionNextRetried
        from ..models.sync_event_session_next_shell_ended import SyncEventSessionNextShellEnded
        from ..models.sync_event_session_next_shell_started import SyncEventSessionNextShellStarted
        from ..models.sync_event_session_next_step_ended import SyncEventSessionNextStepEnded
        from ..models.sync_event_session_next_step_failed import SyncEventSessionNextStepFailed
        from ..models.sync_event_session_next_step_started import SyncEventSessionNextStepStarted
        from ..models.sync_event_session_next_synthetic import SyncEventSessionNextSynthetic
        from ..models.sync_event_session_next_text_delta import SyncEventSessionNextTextDelta
        from ..models.sync_event_session_next_text_ended import SyncEventSessionNextTextEnded
        from ..models.sync_event_session_next_text_started import SyncEventSessionNextTextStarted
        from ..models.sync_event_session_next_tool_called import SyncEventSessionNextToolCalled
        from ..models.sync_event_session_next_tool_failed import SyncEventSessionNextToolFailed
        from ..models.sync_event_session_next_tool_input_delta import SyncEventSessionNextToolInputDelta
        from ..models.sync_event_session_next_tool_input_ended import SyncEventSessionNextToolInputEnded
        from ..models.sync_event_session_next_tool_input_started import SyncEventSessionNextToolInputStarted
        from ..models.sync_event_session_next_tool_progress import SyncEventSessionNextToolProgress
        from ..models.sync_event_session_next_tool_success import SyncEventSessionNextToolSuccess
        from ..models.sync_event_session_updated import SyncEventSessionUpdated

        directory = self.directory

        payload: dict[str, Any]
        if isinstance(self.payload, EventTuiPromptAppend):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventTuiCommandExecute):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventTuiToastShow):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventTuiSessionSelect):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventServerConnected):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventGlobalDisposed):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventServerInstanceDisposed):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventFileEdited):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventFileWatcherUpdated):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventLspClientDiagnostics):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventLspUpdated):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventMessagePartDelta):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventPermissionAsked):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventPermissionReplied):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventSessionDiff):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventSessionError):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventQuestionAsked):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventQuestionReplied):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventQuestionRejected):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventTodoUpdated):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventSessionStatus):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventSessionIdle):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventMcpToolsChanged):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventMcpBrowserOpenFailed):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventCommandExecuted):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventProjectUpdated):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventSessionCompacted):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventVcsBranchUpdated):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventWorkspaceReady):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventWorkspaceFailed):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventWorkspaceStatus):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventWorktreeReady):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventWorktreeFailed):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventPtyCreated):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventPtyUpdated):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventPtyExited):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventPtyDeleted):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventInstallationUpdated):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventInstallationUpdateAvailable):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventMessageUpdated):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventMessageRemoved):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventMessagePartUpdated):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventMessagePartRemoved):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventSessionCreated):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventSessionUpdated):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventSessionDeleted):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventSessionNextAgentSwitched):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventSessionNextModelSwitched):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventSessionNextPrompted):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventSessionNextSynthetic):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventSessionNextShellStarted):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventSessionNextShellEnded):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventSessionNextStepStarted):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventSessionNextStepEnded):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventSessionNextStepFailed):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventSessionNextTextStarted):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventSessionNextTextDelta):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventSessionNextTextEnded):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventSessionNextReasoningStarted):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventSessionNextReasoningDelta):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventSessionNextReasoningEnded):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventSessionNextToolInputStarted):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventSessionNextToolInputDelta):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventSessionNextToolInputEnded):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventSessionNextToolCalled):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventSessionNextToolProgress):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventSessionNextToolSuccess):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventSessionNextToolFailed):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventSessionNextRetried):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventSessionNextCompactionStarted):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventSessionNextCompactionDelta):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventSessionNextCompactionEnded):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventCatalogModelUpdated):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventModelsDevRefreshed):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventAccountAdded):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventAccountRemoved):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, EventAccountSwitched):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, SyncEventMessageUpdated):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, SyncEventMessageRemoved):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, SyncEventMessagePartUpdated):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, SyncEventMessagePartRemoved):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, SyncEventSessionCreated):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, SyncEventSessionUpdated):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, SyncEventSessionDeleted):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, SyncEventSessionNextAgentSwitched):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, SyncEventSessionNextModelSwitched):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, SyncEventSessionNextPrompted):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, SyncEventSessionNextSynthetic):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, SyncEventSessionNextShellStarted):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, SyncEventSessionNextShellEnded):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, SyncEventSessionNextStepStarted):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, SyncEventSessionNextStepEnded):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, SyncEventSessionNextStepFailed):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, SyncEventSessionNextTextStarted):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, SyncEventSessionNextTextDelta):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, SyncEventSessionNextTextEnded):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, SyncEventSessionNextReasoningStarted):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, SyncEventSessionNextReasoningDelta):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, SyncEventSessionNextReasoningEnded):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, SyncEventSessionNextToolInputStarted):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, SyncEventSessionNextToolInputDelta):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, SyncEventSessionNextToolInputEnded):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, SyncEventSessionNextToolCalled):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, SyncEventSessionNextToolProgress):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, SyncEventSessionNextToolSuccess):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, SyncEventSessionNextToolFailed):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, SyncEventSessionNextRetried):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, SyncEventSessionNextCompactionStarted):
            payload = self.payload.to_dict()
        elif isinstance(self.payload, SyncEventSessionNextCompactionDelta):
            payload = self.payload.to_dict()
        else:
            payload = self.payload.to_dict()

        project = self.project

        workspace = self.workspace

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "directory": directory,
                "payload": payload,
            }
        )
        if project is not UNSET:
            field_dict["project"] = project
        if workspace is not UNSET:
            field_dict["workspace"] = workspace

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.event_account_added import EventAccountAdded
        from ..models.event_account_removed import EventAccountRemoved
        from ..models.event_account_switched import EventAccountSwitched
        from ..models.event_catalog_model_updated import EventCatalogModelUpdated
        from ..models.event_command_executed import EventCommandExecuted
        from ..models.event_file_edited import EventFileEdited
        from ..models.event_file_watcher_updated import EventFileWatcherUpdated
        from ..models.event_global_disposed import EventGlobalDisposed
        from ..models.event_installation_update_available import EventInstallationUpdateAvailable
        from ..models.event_installation_updated import EventInstallationUpdated
        from ..models.event_lsp_client_diagnostics import EventLspClientDiagnostics
        from ..models.event_lsp_updated import EventLspUpdated
        from ..models.event_mcp_browser_open_failed import EventMcpBrowserOpenFailed
        from ..models.event_mcp_tools_changed import EventMcpToolsChanged
        from ..models.event_message_part_delta import EventMessagePartDelta
        from ..models.event_message_part_removed import EventMessagePartRemoved
        from ..models.event_message_part_updated import EventMessagePartUpdated
        from ..models.event_message_removed import EventMessageRemoved
        from ..models.event_message_updated import EventMessageUpdated
        from ..models.event_models_dev_refreshed import EventModelsDevRefreshed
        from ..models.event_permission_asked import EventPermissionAsked
        from ..models.event_permission_replied import EventPermissionReplied
        from ..models.event_project_updated import EventProjectUpdated
        from ..models.event_pty_created import EventPtyCreated
        from ..models.event_pty_deleted import EventPtyDeleted
        from ..models.event_pty_exited import EventPtyExited
        from ..models.event_pty_updated import EventPtyUpdated
        from ..models.event_question_asked import EventQuestionAsked
        from ..models.event_question_rejected import EventQuestionRejected
        from ..models.event_question_replied import EventQuestionReplied
        from ..models.event_server_connected import EventServerConnected
        from ..models.event_server_instance_disposed import EventServerInstanceDisposed
        from ..models.event_session_compacted import EventSessionCompacted
        from ..models.event_session_created import EventSessionCreated
        from ..models.event_session_deleted import EventSessionDeleted
        from ..models.event_session_diff import EventSessionDiff
        from ..models.event_session_error import EventSessionError
        from ..models.event_session_idle import EventSessionIdle
        from ..models.event_session_next_agent_switched import EventSessionNextAgentSwitched
        from ..models.event_session_next_compaction_delta import EventSessionNextCompactionDelta
        from ..models.event_session_next_compaction_ended import EventSessionNextCompactionEnded
        from ..models.event_session_next_compaction_started import EventSessionNextCompactionStarted
        from ..models.event_session_next_model_switched import EventSessionNextModelSwitched
        from ..models.event_session_next_prompted import EventSessionNextPrompted
        from ..models.event_session_next_reasoning_delta import EventSessionNextReasoningDelta
        from ..models.event_session_next_reasoning_ended import EventSessionNextReasoningEnded
        from ..models.event_session_next_reasoning_started import EventSessionNextReasoningStarted
        from ..models.event_session_next_retried import EventSessionNextRetried
        from ..models.event_session_next_shell_ended import EventSessionNextShellEnded
        from ..models.event_session_next_shell_started import EventSessionNextShellStarted
        from ..models.event_session_next_step_ended import EventSessionNextStepEnded
        from ..models.event_session_next_step_failed import EventSessionNextStepFailed
        from ..models.event_session_next_step_started import EventSessionNextStepStarted
        from ..models.event_session_next_synthetic import EventSessionNextSynthetic
        from ..models.event_session_next_text_delta import EventSessionNextTextDelta
        from ..models.event_session_next_text_ended import EventSessionNextTextEnded
        from ..models.event_session_next_text_started import EventSessionNextTextStarted
        from ..models.event_session_next_tool_called import EventSessionNextToolCalled
        from ..models.event_session_next_tool_failed import EventSessionNextToolFailed
        from ..models.event_session_next_tool_input_delta import EventSessionNextToolInputDelta
        from ..models.event_session_next_tool_input_ended import EventSessionNextToolInputEnded
        from ..models.event_session_next_tool_input_started import EventSessionNextToolInputStarted
        from ..models.event_session_next_tool_progress import EventSessionNextToolProgress
        from ..models.event_session_next_tool_success import EventSessionNextToolSuccess
        from ..models.event_session_status import EventSessionStatus
        from ..models.event_session_updated import EventSessionUpdated
        from ..models.event_todo_updated import EventTodoUpdated
        from ..models.event_tui_command_execute import EventTuiCommandExecute
        from ..models.event_tui_prompt_append import EventTuiPromptAppend
        from ..models.event_tui_session_select import EventTuiSessionSelect
        from ..models.event_tui_toast_show import EventTuiToastShow
        from ..models.event_vcs_branch_updated import EventVcsBranchUpdated
        from ..models.event_workspace_failed import EventWorkspaceFailed
        from ..models.event_workspace_ready import EventWorkspaceReady
        from ..models.event_workspace_status import EventWorkspaceStatus
        from ..models.event_worktree_failed import EventWorktreeFailed
        from ..models.event_worktree_ready import EventWorktreeReady
        from ..models.sync_event_message_part_removed import SyncEventMessagePartRemoved
        from ..models.sync_event_message_part_updated import SyncEventMessagePartUpdated
        from ..models.sync_event_message_removed import SyncEventMessageRemoved
        from ..models.sync_event_message_updated import SyncEventMessageUpdated
        from ..models.sync_event_session_created import SyncEventSessionCreated
        from ..models.sync_event_session_deleted import SyncEventSessionDeleted
        from ..models.sync_event_session_next_agent_switched import SyncEventSessionNextAgentSwitched
        from ..models.sync_event_session_next_compaction_delta import SyncEventSessionNextCompactionDelta
        from ..models.sync_event_session_next_compaction_ended import SyncEventSessionNextCompactionEnded
        from ..models.sync_event_session_next_compaction_started import SyncEventSessionNextCompactionStarted
        from ..models.sync_event_session_next_model_switched import SyncEventSessionNextModelSwitched
        from ..models.sync_event_session_next_prompted import SyncEventSessionNextPrompted
        from ..models.sync_event_session_next_reasoning_delta import SyncEventSessionNextReasoningDelta
        from ..models.sync_event_session_next_reasoning_ended import SyncEventSessionNextReasoningEnded
        from ..models.sync_event_session_next_reasoning_started import SyncEventSessionNextReasoningStarted
        from ..models.sync_event_session_next_retried import SyncEventSessionNextRetried
        from ..models.sync_event_session_next_shell_ended import SyncEventSessionNextShellEnded
        from ..models.sync_event_session_next_shell_started import SyncEventSessionNextShellStarted
        from ..models.sync_event_session_next_step_ended import SyncEventSessionNextStepEnded
        from ..models.sync_event_session_next_step_failed import SyncEventSessionNextStepFailed
        from ..models.sync_event_session_next_step_started import SyncEventSessionNextStepStarted
        from ..models.sync_event_session_next_synthetic import SyncEventSessionNextSynthetic
        from ..models.sync_event_session_next_text_delta import SyncEventSessionNextTextDelta
        from ..models.sync_event_session_next_text_ended import SyncEventSessionNextTextEnded
        from ..models.sync_event_session_next_text_started import SyncEventSessionNextTextStarted
        from ..models.sync_event_session_next_tool_called import SyncEventSessionNextToolCalled
        from ..models.sync_event_session_next_tool_failed import SyncEventSessionNextToolFailed
        from ..models.sync_event_session_next_tool_input_delta import SyncEventSessionNextToolInputDelta
        from ..models.sync_event_session_next_tool_input_ended import SyncEventSessionNextToolInputEnded
        from ..models.sync_event_session_next_tool_input_started import SyncEventSessionNextToolInputStarted
        from ..models.sync_event_session_next_tool_progress import SyncEventSessionNextToolProgress
        from ..models.sync_event_session_next_tool_success import SyncEventSessionNextToolSuccess
        from ..models.sync_event_session_updated import SyncEventSessionUpdated

        d = dict(src_dict)
        directory = d.pop("directory")

        def _parse_payload(
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
            | EventTuiToastShow
            | EventVcsBranchUpdated
            | EventWorkspaceFailed
            | EventWorkspaceReady
            | EventWorkspaceStatus
            | EventWorktreeFailed
            | EventWorktreeReady
            | SyncEventMessagePartRemoved
            | SyncEventMessagePartUpdated
            | SyncEventMessageRemoved
            | SyncEventMessageUpdated
            | SyncEventSessionCreated
            | SyncEventSessionDeleted
            | SyncEventSessionNextAgentSwitched
            | SyncEventSessionNextCompactionDelta
            | SyncEventSessionNextCompactionEnded
            | SyncEventSessionNextCompactionStarted
            | SyncEventSessionNextModelSwitched
            | SyncEventSessionNextPrompted
            | SyncEventSessionNextReasoningDelta
            | SyncEventSessionNextReasoningEnded
            | SyncEventSessionNextReasoningStarted
            | SyncEventSessionNextRetried
            | SyncEventSessionNextShellEnded
            | SyncEventSessionNextShellStarted
            | SyncEventSessionNextStepEnded
            | SyncEventSessionNextStepFailed
            | SyncEventSessionNextStepStarted
            | SyncEventSessionNextSynthetic
            | SyncEventSessionNextTextDelta
            | SyncEventSessionNextTextEnded
            | SyncEventSessionNextTextStarted
            | SyncEventSessionNextToolCalled
            | SyncEventSessionNextToolFailed
            | SyncEventSessionNextToolInputDelta
            | SyncEventSessionNextToolInputEnded
            | SyncEventSessionNextToolInputStarted
            | SyncEventSessionNextToolProgress
            | SyncEventSessionNextToolSuccess
            | SyncEventSessionUpdated
        ):
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_0 = EventTuiPromptAppend.from_dict(data)

                return payload_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_1 = EventTuiCommandExecute.from_dict(data)

                return payload_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_2 = EventTuiToastShow.from_dict(data)

                return payload_type_2
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_3 = EventTuiSessionSelect.from_dict(data)

                return payload_type_3
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_4 = EventServerConnected.from_dict(data)

                return payload_type_4
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_5 = EventGlobalDisposed.from_dict(data)

                return payload_type_5
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_6 = EventServerInstanceDisposed.from_dict(data)

                return payload_type_6
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_7 = EventFileEdited.from_dict(data)

                return payload_type_7
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_8 = EventFileWatcherUpdated.from_dict(data)

                return payload_type_8
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_9 = EventLspClientDiagnostics.from_dict(data)

                return payload_type_9
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_10 = EventLspUpdated.from_dict(data)

                return payload_type_10
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_11 = EventMessagePartDelta.from_dict(data)

                return payload_type_11
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_12 = EventPermissionAsked.from_dict(data)

                return payload_type_12
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_13 = EventPermissionReplied.from_dict(data)

                return payload_type_13
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_14 = EventSessionDiff.from_dict(data)

                return payload_type_14
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_15 = EventSessionError.from_dict(data)

                return payload_type_15
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_16 = EventQuestionAsked.from_dict(data)

                return payload_type_16
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_17 = EventQuestionReplied.from_dict(data)

                return payload_type_17
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_18 = EventQuestionRejected.from_dict(data)

                return payload_type_18
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_19 = EventTodoUpdated.from_dict(data)

                return payload_type_19
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_20 = EventSessionStatus.from_dict(data)

                return payload_type_20
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_21 = EventSessionIdle.from_dict(data)

                return payload_type_21
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_22 = EventMcpToolsChanged.from_dict(data)

                return payload_type_22
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_23 = EventMcpBrowserOpenFailed.from_dict(data)

                return payload_type_23
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_24 = EventCommandExecuted.from_dict(data)

                return payload_type_24
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_25 = EventProjectUpdated.from_dict(data)

                return payload_type_25
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_26 = EventSessionCompacted.from_dict(data)

                return payload_type_26
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_27 = EventVcsBranchUpdated.from_dict(data)

                return payload_type_27
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_28 = EventWorkspaceReady.from_dict(data)

                return payload_type_28
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_29 = EventWorkspaceFailed.from_dict(data)

                return payload_type_29
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_30 = EventWorkspaceStatus.from_dict(data)

                return payload_type_30
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_31 = EventWorktreeReady.from_dict(data)

                return payload_type_31
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_32 = EventWorktreeFailed.from_dict(data)

                return payload_type_32
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_33 = EventPtyCreated.from_dict(data)

                return payload_type_33
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_34 = EventPtyUpdated.from_dict(data)

                return payload_type_34
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_35 = EventPtyExited.from_dict(data)

                return payload_type_35
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_36 = EventPtyDeleted.from_dict(data)

                return payload_type_36
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_37 = EventInstallationUpdated.from_dict(data)

                return payload_type_37
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_38 = EventInstallationUpdateAvailable.from_dict(data)

                return payload_type_38
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_39 = EventMessageUpdated.from_dict(data)

                return payload_type_39
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_40 = EventMessageRemoved.from_dict(data)

                return payload_type_40
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_41 = EventMessagePartUpdated.from_dict(data)

                return payload_type_41
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_42 = EventMessagePartRemoved.from_dict(data)

                return payload_type_42
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_43 = EventSessionCreated.from_dict(data)

                return payload_type_43
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_44 = EventSessionUpdated.from_dict(data)

                return payload_type_44
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_45 = EventSessionDeleted.from_dict(data)

                return payload_type_45
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_46 = EventSessionNextAgentSwitched.from_dict(data)

                return payload_type_46
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_47 = EventSessionNextModelSwitched.from_dict(data)

                return payload_type_47
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_48 = EventSessionNextPrompted.from_dict(data)

                return payload_type_48
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_49 = EventSessionNextSynthetic.from_dict(data)

                return payload_type_49
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_50 = EventSessionNextShellStarted.from_dict(data)

                return payload_type_50
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_51 = EventSessionNextShellEnded.from_dict(data)

                return payload_type_51
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_52 = EventSessionNextStepStarted.from_dict(data)

                return payload_type_52
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_53 = EventSessionNextStepEnded.from_dict(data)

                return payload_type_53
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_54 = EventSessionNextStepFailed.from_dict(data)

                return payload_type_54
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_55 = EventSessionNextTextStarted.from_dict(data)

                return payload_type_55
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_56 = EventSessionNextTextDelta.from_dict(data)

                return payload_type_56
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_57 = EventSessionNextTextEnded.from_dict(data)

                return payload_type_57
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_58 = EventSessionNextReasoningStarted.from_dict(data)

                return payload_type_58
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_59 = EventSessionNextReasoningDelta.from_dict(data)

                return payload_type_59
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_60 = EventSessionNextReasoningEnded.from_dict(data)

                return payload_type_60
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_61 = EventSessionNextToolInputStarted.from_dict(data)

                return payload_type_61
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_62 = EventSessionNextToolInputDelta.from_dict(data)

                return payload_type_62
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_63 = EventSessionNextToolInputEnded.from_dict(data)

                return payload_type_63
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_64 = EventSessionNextToolCalled.from_dict(data)

                return payload_type_64
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_65 = EventSessionNextToolProgress.from_dict(data)

                return payload_type_65
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_66 = EventSessionNextToolSuccess.from_dict(data)

                return payload_type_66
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_67 = EventSessionNextToolFailed.from_dict(data)

                return payload_type_67
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_68 = EventSessionNextRetried.from_dict(data)

                return payload_type_68
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_69 = EventSessionNextCompactionStarted.from_dict(data)

                return payload_type_69
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_70 = EventSessionNextCompactionDelta.from_dict(data)

                return payload_type_70
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_71 = EventSessionNextCompactionEnded.from_dict(data)

                return payload_type_71
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_72 = EventCatalogModelUpdated.from_dict(data)

                return payload_type_72
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_99 = EventModelsDevRefreshed.from_dict(data)

                return payload_type_99
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_100 = EventAccountAdded.from_dict(data)

                return payload_type_100
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_101 = EventAccountRemoved.from_dict(data)

                return payload_type_101
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_102 = EventAccountSwitched.from_dict(data)

                return payload_type_102
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_103 = SyncEventMessageUpdated.from_dict(data)

                return payload_type_103
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_104 = SyncEventMessageRemoved.from_dict(data)

                return payload_type_104
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_105 = SyncEventMessagePartUpdated.from_dict(data)

                return payload_type_105
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_106 = SyncEventMessagePartRemoved.from_dict(data)

                return payload_type_106
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_107 = SyncEventSessionCreated.from_dict(data)

                return payload_type_107
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_108 = SyncEventSessionUpdated.from_dict(data)

                return payload_type_108
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_109 = SyncEventSessionDeleted.from_dict(data)

                return payload_type_109
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_110 = SyncEventSessionNextAgentSwitched.from_dict(data)

                return payload_type_110
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_111 = SyncEventSessionNextModelSwitched.from_dict(data)

                return payload_type_111
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_112 = SyncEventSessionNextPrompted.from_dict(data)

                return payload_type_112
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_113 = SyncEventSessionNextSynthetic.from_dict(data)

                return payload_type_113
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_114 = SyncEventSessionNextShellStarted.from_dict(data)

                return payload_type_114
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_115 = SyncEventSessionNextShellEnded.from_dict(data)

                return payload_type_115
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_116 = SyncEventSessionNextStepStarted.from_dict(data)

                return payload_type_116
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_117 = SyncEventSessionNextStepEnded.from_dict(data)

                return payload_type_117
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_118 = SyncEventSessionNextStepFailed.from_dict(data)

                return payload_type_118
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_119 = SyncEventSessionNextTextStarted.from_dict(data)

                return payload_type_119
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_120 = SyncEventSessionNextTextDelta.from_dict(data)

                return payload_type_120
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_121 = SyncEventSessionNextTextEnded.from_dict(data)

                return payload_type_121
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_122 = SyncEventSessionNextReasoningStarted.from_dict(data)

                return payload_type_122
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_123 = SyncEventSessionNextReasoningDelta.from_dict(data)

                return payload_type_123
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_124 = SyncEventSessionNextReasoningEnded.from_dict(data)

                return payload_type_124
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_125 = SyncEventSessionNextToolInputStarted.from_dict(data)

                return payload_type_125
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_126 = SyncEventSessionNextToolInputDelta.from_dict(data)

                return payload_type_126
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_127 = SyncEventSessionNextToolInputEnded.from_dict(data)

                return payload_type_127
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_128 = SyncEventSessionNextToolCalled.from_dict(data)

                return payload_type_128
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_129 = SyncEventSessionNextToolProgress.from_dict(data)

                return payload_type_129
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_130 = SyncEventSessionNextToolSuccess.from_dict(data)

                return payload_type_130
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_131 = SyncEventSessionNextToolFailed.from_dict(data)

                return payload_type_131
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_132 = SyncEventSessionNextRetried.from_dict(data)

                return payload_type_132
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_133 = SyncEventSessionNextCompactionStarted.from_dict(data)

                return payload_type_133
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_type_134 = SyncEventSessionNextCompactionDelta.from_dict(data)

                return payload_type_134
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            payload_type_135 = SyncEventSessionNextCompactionEnded.from_dict(data)

            return payload_type_135

        payload = _parse_payload(d.pop("payload"))

        project = d.pop("project", UNSET)

        workspace = d.pop("workspace", UNSET)

        global_event = cls(
            directory=directory,
            payload=payload,
            project=project,
            workspace=workspace,
        )

        return global_event
