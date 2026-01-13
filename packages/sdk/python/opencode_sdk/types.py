"""Type definitions for OpenCode SDK.

This module contains all type definitions matching the OpenCode API schema.
Based on v2 SDK types from packages/sdk/js/src/v2/gen/types.gen.ts
"""

from __future__ import annotations

from typing import Any, Literal, TypedDict, Union


# ============================================================================
# Base Types
# ============================================================================


class FileDiff(TypedDict):
    file: str
    before: str
    after: str
    additions: int
    deletions: int


class Range(TypedDict):
    start: RangePosition
    end: RangePosition


class RangePosition(TypedDict):
    line: int
    character: int


class TimeInfo(TypedDict, total=False):
    created: int
    updated: int
    completed: int
    compacting: int
    archived: int
    initialized: int


class TokenInfo(TypedDict):
    input: int
    output: int
    reasoning: int
    cache: CacheInfo


class CacheInfo(TypedDict):
    read: int
    write: int


# ============================================================================
# Worktree Types (v2)
# ============================================================================


class Worktree(TypedDict):
    name: str
    branch: str
    directory: str


class WorktreeCreateInput(TypedDict, total=False):
    name: str
    startCommand: str


# ============================================================================
# Error Types
# ============================================================================


class ProviderAuthError(TypedDict):
    name: Literal["ProviderAuthError"]
    data: ProviderAuthErrorData


class ProviderAuthErrorData(TypedDict):
    providerID: str
    message: str


class UnknownError(TypedDict):
    name: Literal["UnknownError"]
    data: UnknownErrorData


class UnknownErrorData(TypedDict):
    message: str


class MessageOutputLengthError(TypedDict):
    name: Literal["MessageOutputLengthError"]
    data: dict[str, Any]


class MessageAbortedError(TypedDict):
    name: Literal["MessageAbortedError"]
    data: MessageAbortedErrorData


class MessageAbortedErrorData(TypedDict):
    message: str


class ApiError(TypedDict):
    name: Literal["APIError"]
    data: ApiErrorData


class ApiErrorData(TypedDict, total=False):
    message: str
    statusCode: int
    isRetryable: bool
    responseHeaders: dict[str, str]
    responseBody: str


class BadRequestError(TypedDict):
    data: Any
    errors: list[dict[str, Any]]
    success: Literal[False]


class NotFoundError(TypedDict):
    name: Literal["NotFoundError"]
    data: NotFoundErrorData


class NotFoundErrorData(TypedDict):
    message: str


MessageError = Union[
    ProviderAuthError, UnknownError, MessageOutputLengthError, MessageAbortedError, ApiError
]


# ============================================================================
# Message Types
# ============================================================================


class UserMessageSummary(TypedDict, total=False):
    title: str
    body: str
    diffs: list[FileDiff]


class UserMessageModel(TypedDict):
    providerID: str
    modelID: str


class UserMessage(TypedDict, total=False):
    id: str
    sessionID: str
    role: Literal["user"]
    time: TimeInfo
    summary: UserMessageSummary
    agent: str
    model: UserMessageModel
    system: str
    tools: dict[str, bool]


class AssistantMessagePath(TypedDict):
    cwd: str
    root: str


class AssistantMessage(TypedDict, total=False):
    id: str
    sessionID: str
    role: Literal["assistant"]
    time: TimeInfo
    error: MessageError
    parentID: str
    modelID: str
    providerID: str
    mode: str
    agent: str
    path: AssistantMessagePath
    summary: bool
    cost: float
    tokens: TokenInfo
    finish: str


Message = Union[UserMessage, AssistantMessage]


# ============================================================================
# Part Types
# ============================================================================


class FilePartSourceText(TypedDict):
    value: str
    start: int
    end: int


class FileSource(TypedDict):
    text: FilePartSourceText
    type: Literal["file"]
    path: str


class SymbolSource(TypedDict):
    text: FilePartSourceText
    type: Literal["symbol"]
    path: str
    range: Range
    name: str
    kind: int


class ResourceSource(TypedDict):
    text: FilePartSourceText
    type: Literal["resource"]
    clientName: str
    uri: str


FilePartSource = Union[FileSource, SymbolSource, ResourceSource]


class TextPart(TypedDict, total=False):
    id: str
    sessionID: str
    messageID: str
    type: Literal["text"]
    text: str
    synthetic: bool
    ignored: bool
    time: PartTimeInfo
    metadata: dict[str, Any]


class PartTimeInfo(TypedDict, total=False):
    start: int
    end: int


class ReasoningPart(TypedDict, total=False):
    id: str
    sessionID: str
    messageID: str
    type: Literal["reasoning"]
    text: str
    metadata: dict[str, Any]
    time: PartTimeInfo


class FilePart(TypedDict, total=False):
    id: str
    sessionID: str
    messageID: str
    type: Literal["file"]
    mime: str
    filename: str
    url: str
    source: FilePartSource


class ToolStatePending(TypedDict):
    status: Literal["pending"]
    input: dict[str, Any]
    raw: str


class ToolStateRunningTime(TypedDict):
    start: int


class ToolStateRunning(TypedDict, total=False):
    status: Literal["running"]
    input: dict[str, Any]
    title: str
    metadata: dict[str, Any]
    time: ToolStateRunningTime


class ToolStateCompletedTime(TypedDict, total=False):
    start: int
    end: int
    compacted: int


class ToolStateCompleted(TypedDict, total=False):
    status: Literal["completed"]
    input: dict[str, Any]
    output: str
    title: str
    metadata: dict[str, Any]
    time: ToolStateCompletedTime
    attachments: list[FilePart]


class ToolStateErrorTime(TypedDict):
    start: int
    end: int


class ToolStateError(TypedDict, total=False):
    status: Literal["error"]
    input: dict[str, Any]
    error: str
    metadata: dict[str, Any]
    time: ToolStateErrorTime


ToolState = Union[ToolStatePending, ToolStateRunning, ToolStateCompleted, ToolStateError]


class ToolPart(TypedDict, total=False):
    id: str
    sessionID: str
    messageID: str
    type: Literal["tool"]
    callID: str
    tool: str
    state: ToolState
    metadata: dict[str, Any]


class StepStartPart(TypedDict, total=False):
    id: str
    sessionID: str
    messageID: str
    type: Literal["step-start"]
    snapshot: str


class StepFinishPart(TypedDict):
    id: str
    sessionID: str
    messageID: str
    type: Literal["step-finish"]
    reason: str
    snapshot: str | None
    cost: float
    tokens: TokenInfo


class SnapshotPart(TypedDict):
    id: str
    sessionID: str
    messageID: str
    type: Literal["snapshot"]
    snapshot: str


class PatchPart(TypedDict):
    id: str
    sessionID: str
    messageID: str
    type: Literal["patch"]
    hash: str
    files: list[str]


class AgentPartSource(TypedDict):
    value: str
    start: int
    end: int


class AgentPart(TypedDict, total=False):
    id: str
    sessionID: str
    messageID: str
    type: Literal["agent"]
    name: str
    source: AgentPartSource


class RetryPart(TypedDict):
    id: str
    sessionID: str
    messageID: str
    type: Literal["retry"]
    attempt: int
    error: ApiError
    time: TimeInfo


class CompactionPart(TypedDict):
    id: str
    sessionID: str
    messageID: str
    type: Literal["compaction"]
    auto: bool


class SubtaskPart(TypedDict):
    id: str
    sessionID: str
    messageID: str
    type: Literal["subtask"]
    prompt: str
    description: str
    agent: str


Part = Union[
    TextPart,
    SubtaskPart,
    ReasoningPart,
    FilePart,
    ToolPart,
    StepStartPart,
    StepFinishPart,
    SnapshotPart,
    PatchPart,
    AgentPart,
    RetryPart,
    CompactionPart,
]


# ============================================================================
# Input Part Types
# ============================================================================


class TextPartInput(TypedDict, total=False):
    id: str
    type: Literal["text"]
    text: str
    synthetic: bool
    ignored: bool
    time: PartTimeInfo
    metadata: dict[str, Any]


class FilePartInput(TypedDict, total=False):
    id: str
    type: Literal["file"]
    mime: str
    filename: str
    url: str
    source: FilePartSource


class AgentPartInput(TypedDict, total=False):
    id: str
    type: Literal["agent"]
    name: str
    source: AgentPartSource


class SubtaskPartInput(TypedDict, total=False):
    id: str
    type: Literal["subtask"]
    prompt: str
    description: str
    agent: str


PartInput = Union[TextPartInput, FilePartInput, AgentPartInput, SubtaskPartInput]


# ============================================================================
# Session Types
# ============================================================================


class SessionSummary(TypedDict, total=False):
    additions: int
    deletions: int
    files: int
    diffs: list[FileDiff]


class SessionShare(TypedDict):
    url: str


class SessionRevert(TypedDict, total=False):
    messageID: str
    partID: str
    snapshot: str
    diff: str


class SessionTime(TypedDict, total=False):
    created: int
    updated: int
    compacting: int
    archived: int


class Session(TypedDict, total=False):
    id: str
    projectID: str
    directory: str
    parentID: str
    summary: SessionSummary
    share: SessionShare
    title: str
    version: str
    time: SessionTime
    permission: PermissionRuleset
    revert: SessionRevert


class SessionStatusIdle(TypedDict):
    type: Literal["idle"]


class SessionStatusRetry(TypedDict):
    type: Literal["retry"]
    attempt: int
    message: str
    next: int


class SessionStatusBusy(TypedDict):
    type: Literal["busy"]


SessionStatus = Union[SessionStatusIdle, SessionStatusRetry, SessionStatusBusy]


class Todo(TypedDict):
    content: str
    status: str
    priority: str
    id: str


class PermissionToolInfo(TypedDict, total=False):
    messageID: str
    callID: str


class PermissionRequest(TypedDict, total=False):
    id: str
    sessionID: str
    permission: str
    patterns: list[str]
    metadata: dict[str, Any]
    always: list[str]
    tool: PermissionToolInfo


# ============================================================================
# Question Types (v2)
# ============================================================================


class QuestionOption(TypedDict):
    label: str
    description: str


class QuestionInfo(TypedDict, total=False):
    question: str
    header: str
    options: list[QuestionOption]
    multiple: bool


class QuestionRequest(TypedDict, total=False):
    id: str
    sessionID: str
    questions: list[QuestionInfo]
    tool: PermissionToolInfo


QuestionAnswer = list[str]


class Permission(TypedDict, total=False):
    id: str
    type: str
    pattern: str | list[str]
    sessionID: str
    messageID: str
    callID: str
    title: str
    metadata: dict[str, Any]
    time: TimeInfo


# ============================================================================
# Project Types
# ============================================================================


class ProjectTime(TypedDict, total=False):
    created: int
    updated: int
    initialized: int


class ProjectIcon(TypedDict, total=False):
    url: str
    color: str


class Project(TypedDict, total=False):
    id: str
    worktree: str
    vcs: Literal["git"]
    name: str
    icon: ProjectIcon
    time: ProjectTime
    sandboxes: list[str]


class McpResource(TypedDict, total=False):
    name: str
    uri: str
    description: str
    mimeType: str
    client: str


# ============================================================================
# PTY Types
# ============================================================================


class Pty(TypedDict):
    id: str
    title: str
    command: str
    args: list[str]
    cwd: str
    status: Literal["running", "exited"]
    pid: int


class PtySize(TypedDict):
    rows: int
    cols: int


# ============================================================================
# Config Types
# ============================================================================


class KeybindsConfig(TypedDict, total=False):
    leader: str
    app_exit: str
    editor_open: str
    theme_list: str
    sidebar_toggle: str
    scrollbar_toggle: str
    username_toggle: str
    status_view: str
    session_export: str
    session_new: str
    session_list: str
    session_timeline: str
    session_share: str
    session_unshare: str
    session_interrupt: str
    session_compact: str
    messages_page_up: str
    messages_page_down: str
    messages_half_page_up: str
    messages_half_page_down: str
    messages_first: str
    messages_last: str
    messages_next: str
    messages_previous: str
    messages_last_user: str
    messages_copy: str
    messages_undo: str
    messages_redo: str
    messages_toggle_conceal: str
    tool_details: str
    model_list: str
    model_cycle_recent: str
    model_cycle_recent_reverse: str
    command_list: str
    agent_list: str
    agent_cycle: str
    agent_cycle_reverse: str
    input_clear: str
    input_forward_delete: str
    input_paste: str
    input_submit: str
    input_newline: str
    history_previous: str
    history_next: str
    session_child_cycle: str
    session_child_cycle_reverse: str
    terminal_suspend: str
    terminal_title_toggle: str


PermissionLevel = Literal["ask", "allow", "deny"]


class PermissionRuleset(TypedDict, total=False):
    edit: PermissionLevel
    bash: PermissionLevel | dict[str, PermissionLevel]
    webfetch: PermissionLevel
    doom_loop: PermissionLevel
    external_directory: PermissionLevel


class AgentConfig(TypedDict, total=False):
    model: str
    temperature: float
    top_p: float
    prompt: str
    tools: dict[str, bool]
    disable: bool
    description: str
    mode: Literal["subagent", "primary", "all"]
    color: str
    maxSteps: int
    permission: PermissionRuleset


class ModelCost(TypedDict, total=False):
    input: float
    output: float
    cache_read: float
    cache_write: float
    context_over_200k: ModelCost


class ModelLimit(TypedDict):
    context: int
    output: int


class ModelModalities(TypedDict):
    input: list[Literal["text", "audio", "image", "video", "pdf"]]
    output: list[Literal["text", "audio", "image", "video", "pdf"]]


class ModelConfig(TypedDict, total=False):
    id: str
    name: str
    release_date: str
    attachment: bool
    reasoning: bool
    temperature: bool
    tool_call: bool
    cost: ModelCost
    limit: ModelLimit
    modalities: ModelModalities
    experimental: bool
    status: Literal["alpha", "beta", "deprecated"]
    options: dict[str, Any]
    headers: dict[str, str]
    provider: ProviderRef


class ProviderRef(TypedDict):
    npm: str


class ProviderOptions(TypedDict, total=False):
    apiKey: str
    baseURL: str
    enterpriseUrl: str
    setCacheKey: bool
    timeout: int | Literal[False]


class ProviderConfig(TypedDict, total=False):
    api: str
    name: str
    env: list[str]
    id: str
    npm: str
    models: dict[str, ModelConfig]
    whitelist: list[str]
    blacklist: list[str]
    options: ProviderOptions


class McpOAuthConfig(TypedDict, total=False):
    clientId: str
    clientSecret: str
    scope: str


class McpLocalConfig(TypedDict, total=False):
    type: Literal["local"]
    command: list[str]
    environment: dict[str, str]
    enabled: bool
    timeout: int


class McpRemoteConfig(TypedDict, total=False):
    type: Literal["remote"]
    url: str
    enabled: bool
    headers: dict[str, str]
    oauth: McpOAuthConfig | Literal[False]
    timeout: int


McpConfig = Union[McpLocalConfig, McpRemoteConfig]


class TuiConfig(TypedDict, total=False):
    scroll_speed: int
    scroll_acceleration: ScrollAccelerationConfig
    diff_style: Literal["auto", "stacked"]


class ScrollAccelerationConfig(TypedDict):
    enabled: bool


class CommandConfig(TypedDict, total=False):
    template: str
    description: str
    agent: str
    model: str
    subtask: bool


class WatcherConfig(TypedDict, total=False):
    ignore: list[str]


class FormatterExtensionConfig(TypedDict, total=False):
    disabled: bool
    command: list[str]
    environment: dict[str, str]
    extensions: list[str]


class LspEnabledConfig(TypedDict, total=False):
    command: list[str]
    extensions: list[str]
    disabled: bool
    env: dict[str, str]
    initialization: dict[str, Any]


class LspDisabledConfig(TypedDict):
    disabled: Literal[True]


LspConfig = Union[LspEnabledConfig, LspDisabledConfig]


class HookCommand(TypedDict, total=False):
    command: list[str]
    environment: dict[str, str]


class ExperimentalHooks(TypedDict, total=False):
    file_edited: dict[str, list[HookCommand]]
    session_completed: list[HookCommand]


class ExperimentalConfig(TypedDict, total=False):
    hook: ExperimentalHooks
    chatMaxRetries: int
    disable_paste_summary: bool
    batch_tool: bool
    openTelemetry: bool
    primary_tools: list[str]


class EnterpriseConfig(TypedDict, total=False):
    url: str


class Config(TypedDict, total=False):
    schema_: str  # $schema
    theme: str
    keybinds: KeybindsConfig
    logLevel: Literal["DEBUG", "INFO", "WARN", "ERROR"]
    tui: TuiConfig
    command: dict[str, CommandConfig]
    watcher: WatcherConfig
    plugin: list[str]
    snapshot: bool
    share: Literal["manual", "auto", "disabled"]
    autoshare: bool
    autoupdate: bool | Literal["notify"]
    disabled_providers: list[str]
    enabled_providers: list[str]
    model: str
    small_model: str
    username: str
    mode: dict[str, AgentConfig]
    agent: dict[str, AgentConfig]
    provider: dict[str, ProviderConfig]
    mcp: dict[str, McpConfig]
    formatter: Literal[False] | dict[str, FormatterExtensionConfig]
    lsp: Literal[False] | dict[str, LspConfig]
    instructions: list[str]
    layout: Literal["auto", "stretch"]
    permission: PermissionRuleset
    tools: dict[str, bool]
    enterprise: EnterpriseConfig
    experimental: ExperimentalConfig


# ============================================================================
# Tool Types
# ============================================================================


class ToolListItem(TypedDict):
    id: str
    description: str
    parameters: Any


ToolIds = list[str]
ToolList = list[ToolListItem]


# ============================================================================
# Path Types
# ============================================================================


class PathInfo(TypedDict):
    home: str
    state: str
    config: str
    worktree: str
    directory: str


# ============================================================================
# VCS Types
# ============================================================================


class VcsInfo(TypedDict):
    branch: str


# ============================================================================
# Command Types
# ============================================================================


class Command(TypedDict, total=False):
    name: str
    description: str
    agent: str
    model: str
    mcp: bool
    template: str
    subtask: bool
    hints: list[str]


# ============================================================================
# Provider Types
# ============================================================================


class ModelCapabilities(TypedDict):
    temperature: bool
    reasoning: bool
    attachment: bool
    toolcall: bool
    input: ModalityCapabilities
    output: ModalityCapabilities


class ModalityCapabilities(TypedDict):
    text: bool
    audio: bool
    image: bool
    video: bool
    pdf: bool


class ModelCostInfo(TypedDict, total=False):
    input: float
    output: float
    cache: CacheInfo
    experimentalOver200K: ModelCostInfo


class Model(TypedDict, total=False):
    id: str
    providerID: str
    api: ModelApi
    name: str
    capabilities: ModelCapabilities
    cost: ModelCostInfo
    limit: ModelLimit
    status: Literal["alpha", "beta", "deprecated", "active"]
    options: dict[str, Any]
    headers: dict[str, str]


class ModelApi(TypedDict):
    id: str
    url: str
    npm: str


class Provider(TypedDict, total=False):
    id: str
    name: str
    source: Literal["env", "config", "custom", "api"]
    env: list[str]
    key: str
    options: dict[str, Any]
    models: dict[str, Model]


class ProviderAuthMethod(TypedDict):
    type: Literal["oauth", "api"]
    label: str


class ProviderAuthAuthorization(TypedDict):
    url: str
    method: Literal["auto", "code"]
    instructions: str


# ============================================================================
# Find Types
# ============================================================================


class FindMatch(TypedDict):
    path: FindMatchText
    lines: FindMatchText
    line_number: int
    absolute_offset: int
    submatches: list[FindSubmatch]


class FindMatchText(TypedDict):
    text: str


class FindSubmatch(TypedDict):
    match: FindMatchText
    start: int
    end: int


class Symbol(TypedDict):
    name: str
    kind: int
    location: SymbolLocation


class SymbolLocation(TypedDict):
    uri: str
    range: Range


# ============================================================================
# File Types
# ============================================================================


class FileNode(TypedDict):
    name: str
    path: str
    absolute: str
    type: Literal["file", "directory"]
    ignored: bool


class PatchHunk(TypedDict):
    oldStart: int
    oldLines: int
    newStart: int
    newLines: int
    lines: list[str]


class FilePatch(TypedDict, total=False):
    oldFileName: str
    newFileName: str
    oldHeader: str
    newHeader: str
    hunks: list[PatchHunk]
    index: str


class FileContent(TypedDict, total=False):
    type: Literal["text"]
    content: str
    diff: str
    patch: FilePatch
    encoding: Literal["base64"]
    mimeType: str


class FileStatus(TypedDict):
    path: str
    added: int
    removed: int
    status: Literal["added", "deleted", "modified"]


# ============================================================================
# Agent Types
# ============================================================================


class Agent(TypedDict, total=False):
    name: str
    description: str
    mode: Literal["subagent", "primary", "all"]
    native: bool
    hidden: bool
    topP: float
    temperature: float
    color: str
    permission: PermissionRuleset
    model: AgentModel
    prompt: str
    options: dict[str, Any]
    steps: int


class AgentPermission(TypedDict, total=False):
    edit: PermissionLevel
    bash: dict[str, PermissionLevel]
    webfetch: PermissionLevel
    doom_loop: PermissionLevel
    external_directory: PermissionLevel


class AgentModel(TypedDict):
    modelID: str
    providerID: str


# ============================================================================
# MCP Types
# ============================================================================


class McpStatusConnected(TypedDict):
    status: Literal["connected"]


class McpStatusDisabled(TypedDict):
    status: Literal["disabled"]


class McpStatusFailed(TypedDict):
    status: Literal["failed"]
    error: str


class McpStatusNeedsAuth(TypedDict):
    status: Literal["needs_auth"]


class McpStatusNeedsClientRegistration(TypedDict):
    status: Literal["needs_client_registration"]
    error: str


McpStatus = Union[
    McpStatusConnected,
    McpStatusDisabled,
    McpStatusFailed,
    McpStatusNeedsAuth,
    McpStatusNeedsClientRegistration,
]


# ============================================================================
# LSP Types
# ============================================================================


class LspStatus(TypedDict):
    id: str
    name: str
    root: str
    status: Literal["connected", "error"]


# ============================================================================
# Formatter Types
# ============================================================================


class FormatterStatus(TypedDict):
    name: str
    extensions: list[str]
    enabled: bool


# ============================================================================
# Auth Types
# ============================================================================


class OAuthAuth(TypedDict, total=False):
    type: Literal["oauth"]
    refresh: str
    access: str
    expires: int
    enterpriseUrl: str


class ApiAuth(TypedDict):
    type: Literal["api"]
    key: str


class WellKnownAuth(TypedDict):
    type: Literal["wellknown"]
    key: str
    token: str


Auth = Union[OAuthAuth, ApiAuth, WellKnownAuth]


# ============================================================================
# Event Types
# ============================================================================


class EventServerInstanceDisposed(TypedDict):
    type: Literal["server.instance.disposed"]
    properties: EventServerInstanceDisposedProps


class EventServerInstanceDisposedProps(TypedDict):
    directory: str


class EventInstallationUpdated(TypedDict):
    type: Literal["installation.updated"]
    properties: EventInstallationUpdatedProps


class EventInstallationUpdatedProps(TypedDict):
    version: str


class EventInstallationUpdateAvailable(TypedDict):
    type: Literal["installation.update-available"]
    properties: EventInstallationUpdateAvailableProps


class EventInstallationUpdateAvailableProps(TypedDict):
    version: str


class EventLspClientDiagnostics(TypedDict):
    type: Literal["lsp.client.diagnostics"]
    properties: EventLspClientDiagnosticsProps


class EventLspClientDiagnosticsProps(TypedDict):
    serverID: str
    path: str


class EventLspUpdated(TypedDict):
    type: Literal["lsp.updated"]
    properties: dict[str, Any]


class EventMessageUpdated(TypedDict):
    type: Literal["message.updated"]
    properties: EventMessageUpdatedProps


class EventMessageUpdatedProps(TypedDict):
    info: Message


class EventMessageRemoved(TypedDict):
    type: Literal["message.removed"]
    properties: EventMessageRemovedProps


class EventMessageRemovedProps(TypedDict):
    sessionID: str
    messageID: str


class EventMessagePartUpdated(TypedDict):
    type: Literal["message.part.updated"]
    properties: EventMessagePartUpdatedProps


class EventMessagePartUpdatedProps(TypedDict, total=False):
    part: Part
    delta: str


class EventMessagePartRemoved(TypedDict):
    type: Literal["message.part.removed"]
    properties: EventMessagePartRemovedProps


class EventMessagePartRemovedProps(TypedDict):
    sessionID: str
    messageID: str
    partID: str


class EventPermissionAsked(TypedDict):
    type: Literal["permission.asked"]
    properties: PermissionRequest


class EventPermissionReplied(TypedDict):
    type: Literal["permission.replied"]
    properties: EventPermissionRepliedProps


class EventPermissionRepliedProps(TypedDict):
    sessionID: str
    requestID: str
    reply: Literal["once", "always", "reject"]


class EventQuestionAsked(TypedDict):
    type: Literal["question.asked"]
    properties: QuestionRequest


class EventQuestionReplied(TypedDict):
    type: Literal["question.replied"]
    properties: EventQuestionRepliedProps


class EventQuestionRepliedProps(TypedDict):
    sessionID: str
    requestID: str
    answers: list[QuestionAnswer]


class EventQuestionRejected(TypedDict):
    type: Literal["question.rejected"]
    properties: EventQuestionRejectedProps


class EventQuestionRejectedProps(TypedDict):
    sessionID: str
    requestID: str


class EventSessionStatus(TypedDict):
    type: Literal["session.status"]
    properties: EventSessionStatusProps


class EventSessionStatusProps(TypedDict):
    sessionID: str
    status: SessionStatus


class EventSessionIdle(TypedDict):
    type: Literal["session.idle"]
    properties: EventSessionIdleProps


class EventSessionIdleProps(TypedDict):
    sessionID: str


class EventSessionCompacted(TypedDict):
    type: Literal["session.compacted"]
    properties: EventSessionCompactedProps


class EventSessionCompactedProps(TypedDict):
    sessionID: str


class EventFileEdited(TypedDict):
    type: Literal["file.edited"]
    properties: EventFileEditedProps


class EventFileEditedProps(TypedDict):
    file: str


class EventTodoUpdated(TypedDict):
    type: Literal["todo.updated"]
    properties: EventTodoUpdatedProps


class EventTodoUpdatedProps(TypedDict):
    sessionID: str
    todos: list[Todo]


class EventCommandExecuted(TypedDict):
    type: Literal["command.executed"]
    properties: EventCommandExecutedProps


class EventCommandExecutedProps(TypedDict):
    name: str
    sessionID: str
    arguments: str
    messageID: str


class EventSessionCreated(TypedDict):
    type: Literal["session.created"]
    properties: EventSessionCreatedProps


class EventSessionCreatedProps(TypedDict):
    info: Session


class EventSessionUpdated(TypedDict):
    type: Literal["session.updated"]
    properties: EventSessionUpdatedProps


class EventSessionUpdatedProps(TypedDict):
    info: Session


class EventSessionDeleted(TypedDict):
    type: Literal["session.deleted"]
    properties: EventSessionDeletedProps


class EventSessionDeletedProps(TypedDict):
    info: Session


class EventSessionDiff(TypedDict):
    type: Literal["session.diff"]
    properties: EventSessionDiffProps


class EventSessionDiffProps(TypedDict):
    sessionID: str
    diff: list[FileDiff]


class EventSessionError(TypedDict):
    type: Literal["session.error"]
    properties: EventSessionErrorProps


class EventSessionErrorProps(TypedDict, total=False):
    sessionID: str
    error: MessageError


class EventFileWatcherUpdated(TypedDict):
    type: Literal["file.watcher.updated"]
    properties: EventFileWatcherUpdatedProps


class EventFileWatcherUpdatedProps(TypedDict):
    file: str
    event: Literal["add", "change", "unlink"]


class EventVcsBranchUpdated(TypedDict):
    type: Literal["vcs.branch.updated"]
    properties: EventVcsBranchUpdatedProps


class EventVcsBranchUpdatedProps(TypedDict, total=False):
    branch: str


class EventTuiPromptAppend(TypedDict):
    type: Literal["tui.prompt.append"]
    properties: EventTuiPromptAppendProps


class EventTuiPromptAppendProps(TypedDict):
    text: str


TuiCommand = Literal[
    "session.list",
    "session.new",
    "session.share",
    "session.interrupt",
    "session.compact",
    "session.page.up",
    "session.page.down",
    "session.half.page.up",
    "session.half.page.down",
    "session.first",
    "session.last",
    "prompt.clear",
    "prompt.submit",
    "agent.cycle",
]


class EventTuiCommandExecute(TypedDict):
    type: Literal["tui.command.execute"]
    properties: EventTuiCommandExecuteProps


class EventTuiCommandExecuteProps(TypedDict):
    command: TuiCommand | str


class EventTuiToastShow(TypedDict):
    type: Literal["tui.toast.show"]
    properties: EventTuiToastShowProps


class EventTuiToastShowProps(TypedDict, total=False):
    title: str
    message: str
    variant: Literal["info", "success", "warning", "error"]
    duration: int


class EventPtyCreated(TypedDict):
    type: Literal["pty.created"]
    properties: EventPtyCreatedProps


class EventPtyCreatedProps(TypedDict):
    info: Pty


class EventPtyUpdated(TypedDict):
    type: Literal["pty.updated"]
    properties: EventPtyUpdatedProps


class EventPtyUpdatedProps(TypedDict):
    info: Pty


class EventPtyExited(TypedDict):
    type: Literal["pty.exited"]
    properties: EventPtyExitedProps


class EventPtyExitedProps(TypedDict):
    id: str
    exitCode: int


class EventPtyDeleted(TypedDict):
    type: Literal["pty.deleted"]
    properties: EventPtyDeletedProps


class EventPtyDeletedProps(TypedDict):
    id: str


class EventServerConnected(TypedDict):
    type: Literal["server.connected"]
    properties: dict[str, Any]


class EventGlobalDisposed(TypedDict):
    type: Literal["global.disposed"]
    properties: dict[str, Any]


class EventTuiSessionSelect(TypedDict):
    type: Literal["tui.session.select"]
    properties: EventTuiSessionSelectProps


class EventTuiSessionSelectProps(TypedDict):
    sessionID: str


class EventMcpToolsChanged(TypedDict):
    type: Literal["mcp.tools.changed"]
    properties: EventMcpToolsChangedProps


class EventMcpToolsChangedProps(TypedDict):
    server: str


class EventProjectUpdated(TypedDict):
    type: Literal["project.updated"]
    properties: Project


Event = Union[
    EventServerInstanceDisposed,
    EventInstallationUpdated,
    EventInstallationUpdateAvailable,
    EventProjectUpdated,
    EventLspClientDiagnostics,
    EventLspUpdated,
    EventMessageUpdated,
    EventMessageRemoved,
    EventMessagePartUpdated,
    EventMessagePartRemoved,
    EventPermissionAsked,
    EventPermissionReplied,
    EventQuestionAsked,
    EventQuestionReplied,
    EventQuestionRejected,
    EventSessionStatus,
    EventSessionIdle,
    EventSessionCompacted,
    EventFileEdited,
    EventTodoUpdated,
    EventCommandExecuted,
    EventSessionCreated,
    EventSessionUpdated,
    EventSessionDeleted,
    EventSessionDiff,
    EventSessionError,
    EventFileWatcherUpdated,
    EventVcsBranchUpdated,
    EventTuiPromptAppend,
    EventTuiCommandExecute,
    EventTuiToastShow,
    EventTuiSessionSelect,
    EventMcpToolsChanged,
    EventPtyCreated,
    EventPtyUpdated,
    EventPtyExited,
    EventPtyDeleted,
    EventServerConnected,
    EventGlobalDisposed,
]


class GlobalEvent(TypedDict):
    directory: str
    payload: Event


# ============================================================================
# Response Types
# ============================================================================


class MessageWithParts(TypedDict):
    info: Message
    parts: list[Part]


class AssistantMessageWithParts(TypedDict):
    info: AssistantMessage
    parts: list[Part]


class ProviderListResponse(TypedDict):
    all: list[Provider]
    default: dict[str, str]
    connected: list[str]


class ConfigProvidersResponse(TypedDict):
    providers: list[Provider]
    default: dict[str, str]


class McpAuthStartResponse(TypedDict):
    authorizationUrl: str


class McpAuthRemoveResponse(TypedDict):
    success: Literal[True]


class TuiControlNextResponse(TypedDict):
    path: str
    body: Any
