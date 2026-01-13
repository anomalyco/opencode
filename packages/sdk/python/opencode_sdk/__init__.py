"""OpenCode SDK for Python.

This package provides a Python client for interacting with the OpenCode API.

Example usage:
    from opencode_sdk import create_opencode

    # Start server and client together (like JS SDK)
    opencode = create_opencode()
    print(f"Server running at {opencode.server.url}")

    # Create a session and send a prompt
    session = opencode.client.session.create()
    if session.ok:
        response = opencode.client.session.prompt(
            session.data["id"],
            parts=[{"type": "text", "text": "Hello, world!"}]
        )
        print(response.data)

    # Cleanup
    opencode.close()

    # Or use async
    import asyncio

    async def main():
        opencode = await create_opencode_async()

        session = await opencode.client.session.create_async()
        if session.ok:
            response = await opencode.client.session.prompt_async(
                session.data["id"],
                parts=[{"type": "text", "text": "Hello, world!"}]
            )
            print(response.data)

        await opencode.aclose()

    asyncio.run(main())

    # Client only (connect to existing server)
    from opencode_sdk import create_opencode_client

    client = create_opencode_client(base_url="http://localhost:4096")
    sessions = client.session.list()
    client.close()
"""

from .client import ClientConfig, HttpClient, Response, SseEvent, suppress_asyncgen_warnings
from .sdk import (
    AppApi,
    AuthApi,
    CommandApi,
    ConfigApi,
    EventApi,
    ExperimentalApi,
    FileApi,
    FindApi,
    FormatterApi,
    GlobalApi,
    InstanceApi,
    LspApi,
    McpApi,
    McpAuthApi,
    OAuthApi,
    OpencodeClient,
    PartApi,
    PathApi,
    PermissionApi,
    ProjectApi,
    ProviderApi,
    PtyApi,
    QuestionApi,
    ResourceApi,
    SessionApi,
    ToolApi,
    TuiApi,
    TuiControlApi,
    VcsApi,
    WorktreeApi,
    create_opencode_client,
)
from .server import (
    AsyncServer,
    Server,
    ServerOptions,
    Tui,
    TuiOptions,
    create_opencode_server,
    create_opencode_server_async,
    create_opencode_tui,
)
from .types import (
    Agent,
    AgentConfig,
    AgentPart,
    AgentPartInput,
    ApiAuth,
    ApiError,
    AssistantMessage,
    AssistantMessageWithParts,
    Auth,
    BadRequestError,
    Command,
    CompactionPart,
    Config,
    Event,
    FileDiff,
    FileContent,
    FileNode,
    FilePart,
    FilePartInput,
    FileStatus,
    FindMatch,
    FormatterStatus,
    GlobalEvent,
    LspStatus,
    McpConfig,
    McpLocalConfig,
    McpRemoteConfig,
    McpResource,
    McpStatus,
    Message,
    MessageError,
    MessageWithParts,
    Model,
    NotFoundError,
    OAuthAuth,
    Part,
    PartInput,
    PathInfo,
    Permission,
    PermissionRequest,
    PermissionRuleset,
    PermissionToolInfo,
    PatchPart,
    Project,
    Provider,
    ProviderAuthAuthorization,
    ProviderAuthMethod,
    ProviderConfig,
    ProviderListResponse,
    Pty,
    PtySize,
    QuestionAnswer,
    QuestionInfo,
    QuestionOption,
    QuestionRequest,
    ReasoningPart,
    ResourceSource,
    RetryPart,
    Session,
    SessionStatus,
    SnapshotPart,
    StepFinishPart,
    StepStartPart,
    SubtaskPart,
    SubtaskPartInput,
    Symbol,
    TextPart,
    TextPartInput,
    Todo,
    ToolIds,
    ToolList,
    ToolListItem,
    ToolPart,
    ToolState,
    UserMessage,
    VcsInfo,
    WellKnownAuth,
    Worktree,
    WorktreeCreateInput,
)

__version__ = "1.1.15"


class Opencode:

    def __init__(self, client: OpencodeClient, server: Server) -> None:
        self.client = client
        self.server = server

    def close(self) -> None:
        self.client.close()
        self.server.close()


class AsyncOpencode:

    def __init__(self, client: OpencodeClient, server: AsyncServer) -> None:
        self.client = client
        self.server = server

    async def aclose(self) -> None:
        await self.client.aclose()
        self.server.close()


def create_opencode(
    hostname: str = "127.0.0.1",
    port: int = 4096,
    timeout: float = 5.0,
    config: "Config | None" = None,
) -> Opencode:
    options = ServerOptions(hostname=hostname, port=port, timeout=timeout, config=config)
    server = create_opencode_server(options)
    client = create_opencode_client(base_url=server.url)
    return Opencode(client, server)


async def create_opencode_async(
    hostname: str = "127.0.0.1",
    port: int = 4096,
    timeout: float = 5.0,
    config: "Config | None" = None,
) -> AsyncOpencode:
    options = ServerOptions(hostname=hostname, port=port, timeout=timeout, config=config)
    server = await create_opencode_server_async(options)
    client = create_opencode_client(base_url=server.url)
    return AsyncOpencode(client, server)


__all__ = [
    "Opencode",
    "AsyncOpencode",
    "create_opencode",
    "create_opencode_async",
    "OpencodeClient",
    "create_opencode_client",
    "Server",
    "AsyncServer",
    "Tui",
    "ServerOptions",
    "TuiOptions",
    "create_opencode_server",
    "create_opencode_server_async",
    "create_opencode_tui",
    "HttpClient",
    "ClientConfig",
    "Response",
    "SseEvent",
    "suppress_asyncgen_warnings",
    "GlobalApi",
    "ProjectApi",
    "PtyApi",
    "ConfigApi",
    "ToolApi",
    "InstanceApi",
    "PathApi",
    "VcsApi",
    "SessionApi",
    "PartApi",
    "PermissionApi",
    "QuestionApi",
    "WorktreeApi",
    "ResourceApi",
    "ExperimentalApi",
    "CommandApi",
    "ProviderApi",
    "OAuthApi",
    "FindApi",
    "FileApi",
    "AppApi",
    "McpApi",
    "McpAuthApi",
    "LspApi",
    "FormatterApi",
    "TuiApi",
    "TuiControlApi",
    "AuthApi",
    "EventApi",
    "Agent",
    "AgentConfig",
    "AgentPart",
    "AgentPartInput",
    "ApiAuth",
    "ApiError",
    "AssistantMessage",
    "AssistantMessageWithParts",
    "Auth",
    "BadRequestError",
    "Command",
    "CompactionPart",
    "Config",
    "Event",
    "FileDiff",
    "FileContent",
    "FileNode",
    "FilePart",
    "FilePartInput",
    "FileStatus",
    "FindMatch",
    "FormatterStatus",
    "GlobalEvent",
    "LspStatus",
    "McpConfig",
    "McpLocalConfig",
    "McpRemoteConfig",
    "McpResource",
    "McpStatus",
    "Message",
    "MessageError",
    "MessageWithParts",
    "Model",
    "NotFoundError",
    "OAuthAuth",
    "Part",
    "PartInput",
    "PathInfo",
    "Permission",
    "PermissionRequest",
    "PermissionRuleset",
    "PermissionToolInfo",
    "PatchPart",
    "Project",
    "Provider",
    "ProviderAuthAuthorization",
    "ProviderAuthMethod",
    "ProviderConfig",
    "ProviderListResponse",
    "Pty",
    "PtySize",
    "QuestionAnswer",
    "QuestionInfo",
    "QuestionOption",
    "QuestionRequest",
    "ReasoningPart",
    "ResourceSource",
    "RetryPart",
    "Session",
    "SessionStatus",
    "SnapshotPart",
    "StepFinishPart",
    "StepStartPart",
    "SubtaskPart",
    "SubtaskPartInput",
    "Symbol",
    "TextPart",
    "TextPartInput",
    "Todo",
    "ToolIds",
    "ToolList",
    "ToolListItem",
    "ToolPart",
    "ToolState",
    "UserMessage",
    "VcsInfo",
    "WellKnownAuth",
    "Worktree",
    "WorktreeCreateInput",
]
