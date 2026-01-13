"""OpenCode SDK - Main client implementation.

This module provides the OpencodeClient class with all API methods.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Iterator
from typing import Any, Literal, TypedDict

from .client import ClientConfig, HttpClient, Response, SseEvent
from .types import (
    Agent,
    AssistantMessageWithParts,
    Auth,
    Command,
    Config,
    ConfigProvidersResponse,
    Event,
    FileDiff,
    FileContent,
    FileNode,
    FileStatus,
    FindMatch,
    FormatterStatus,
    GlobalEvent,
    LspStatus,
    McpConfig,
    McpResource,
    McpStatus,
    MessageWithParts,
    Part,
    PathInfo,
    PartInput,
    PermissionRequest,
    PermissionRuleset,
    Project,
    Provider,
    ProviderAuthAuthorization,
    ProviderAuthMethod,
    ProviderListResponse,
    Pty,
    PtySize,
    QuestionAnswer,
    QuestionRequest,
    Session,
    SessionStatus,
    Symbol,
    Todo,
    ToolIds,
    ToolList,
    TuiControlNextResponse,
    VcsInfo,
    Worktree,
    WorktreeCreateInput,
)


class GlobalHealthResponse(TypedDict):
    healthy: Literal[True]
    version: str


class GlobalApi:

    def __init__(self, client: HttpClient) -> None:
        self._client = client

    def health(self) -> Response[GlobalHealthResponse]:
        return self._client.get("/global/health")

    async def health_async(self) -> Response[GlobalHealthResponse]:
        return await self._client.aget("/global/health")

    def event(self) -> Iterator[SseEvent[GlobalEvent]]:
        return self._client.sse("/global/event")

    async def event_async(self) -> AsyncIterator[SseEvent[GlobalEvent]]:
        async for event in self._client.asse("/global/event"):
            yield event

    def dispose(self) -> Response[bool]:
        return self._client.post("/global/dispose")

    async def dispose_async(self) -> Response[bool]:
        return await self._client.apost("/global/dispose")


class ProjectApi:
    """Project API endpoints."""

    def __init__(self, client: HttpClient) -> None:
        self._client = client

    def list(self, *, directory: str | None = None) -> Response[list[Project]]:
        """List all projects."""
        return self._client.get("/project", query_params={"directory": directory})

    async def list_async(self, *, directory: str | None = None) -> Response[list[Project]]:
        """List all projects (async)."""
        return await self._client.aget("/project", query_params={"directory": directory})

    def current(self, *, directory: str | None = None) -> Response[Project]:
        return self._client.get("/project/current", query_params={"directory": directory})

    async def current_async(self, *, directory: str | None = None) -> Response[Project]:
        return await self._client.aget("/project/current", query_params={"directory": directory})

    def update(
        self,
        project_id: str,
        *,
        name: str | None = None,
        icon: dict[str, str] | None = None,
        directory: str | None = None,
    ) -> Response[Project]:
        body: dict[str, Any] = {}
        if name is not None:
            body["name"] = name
        if icon is not None:
            body["icon"] = icon
        return self._client.patch(
            "/project/{projectID}",
            path_params={"projectID": project_id},
            body=body or None,
            query_params={"directory": directory},
        )

    async def update_async(
        self,
        project_id: str,
        *,
        name: str | None = None,
        icon: dict[str, str] | None = None,
        directory: str | None = None,
    ) -> Response[Project]:
        body: dict[str, Any] = {}
        if name is not None:
            body["name"] = name
        if icon is not None:
            body["icon"] = icon
        return await self._client.apatch(
            "/project/{projectID}",
            path_params={"projectID": project_id},
            body=body or None,
            query_params={"directory": directory},
        )


class PtyApi:
    """PTY API endpoints."""

    def __init__(self, client: HttpClient) -> None:
        self._client = client

    def list(self, *, directory: str | None = None) -> Response[list[Pty]]:
        """List all PTY sessions."""
        return self._client.get("/pty", query_params={"directory": directory})

    async def list_async(self, *, directory: str | None = None) -> Response[list[Pty]]:
        """List all PTY sessions (async)."""
        return await self._client.aget("/pty", query_params={"directory": directory})

    def create(
        self,
        *,
        command: str | None = None,
        args: list[str] | None = None,
        cwd: str | None = None,
        title: str | None = None,
        env: dict[str, str] | None = None,
        directory: str | None = None,
    ) -> Response[Pty]:
        """Create a new PTY session."""
        body: dict[str, Any] = {}
        if command is not None:
            body["command"] = command
        if args is not None:
            body["args"] = args
        if cwd is not None:
            body["cwd"] = cwd
        if title is not None:
            body["title"] = title
        if env is not None:
            body["env"] = env
        return self._client.post("/pty", body=body or None, query_params={"directory": directory})

    async def create_async(
        self,
        *,
        command: str | None = None,
        args: list[str] | None = None,
        cwd: str | None = None,
        title: str | None = None,
        env: dict[str, str] | None = None,
        directory: str | None = None,
    ) -> Response[Pty]:
        """Create a new PTY session (async)."""
        body: dict[str, Any] = {}
        if command is not None:
            body["command"] = command
        if args is not None:
            body["args"] = args
        if cwd is not None:
            body["cwd"] = cwd
        if title is not None:
            body["title"] = title
        if env is not None:
            body["env"] = env
        return await self._client.apost(
            "/pty", body=body or None, query_params={"directory": directory}
        )

    def remove(self, pty_id: str, *, directory: str | None = None) -> Response[bool]:
        """Remove a PTY session."""
        return self._client.delete(
            "/pty/{ptyID}", path_params={"ptyID": pty_id}, query_params={"directory": directory}
        )

    async def remove_async(self, pty_id: str, *, directory: str | None = None) -> Response[bool]:
        """Remove a PTY session (async)."""
        return await self._client.adelete(
            "/pty/{ptyID}", path_params={"ptyID": pty_id}, query_params={"directory": directory}
        )

    def get(self, pty_id: str, *, directory: str | None = None) -> Response[Pty]:
        """Get PTY session info."""
        return self._client.get(
            "/pty/{ptyID}", path_params={"ptyID": pty_id}, query_params={"directory": directory}
        )

    async def get_async(self, pty_id: str, *, directory: str | None = None) -> Response[Pty]:
        """Get PTY session info (async)."""
        return await self._client.aget(
            "/pty/{ptyID}", path_params={"ptyID": pty_id}, query_params={"directory": directory}
        )

    def update(
        self,
        pty_id: str,
        *,
        title: str | None = None,
        size: PtySize | None = None,
        directory: str | None = None,
    ) -> Response[Pty]:
        """Update PTY session."""
        body: dict[str, Any] = {}
        if title is not None:
            body["title"] = title
        if size is not None:
            body["size"] = size
        return self._client.put(
            "/pty/{ptyID}",
            path_params={"ptyID": pty_id},
            body=body or None,
            query_params={"directory": directory},
        )

    async def update_async(
        self,
        pty_id: str,
        *,
        title: str | None = None,
        size: PtySize | None = None,
        directory: str | None = None,
    ) -> Response[Pty]:
        """Update PTY session (async)."""
        body: dict[str, Any] = {}
        if title is not None:
            body["title"] = title
        if size is not None:
            body["size"] = size
        return await self._client.aput(
            "/pty/{ptyID}",
            path_params={"ptyID": pty_id},
            body=body or None,
            query_params={"directory": directory},
        )

    def connect(self, pty_id: str, *, directory: str | None = None) -> Response[bool]:
        """Connect to a PTY session."""
        return self._client.get(
            "/pty/{ptyID}/connect", path_params={"ptyID": pty_id}, query_params={"directory": directory}
        )

    async def connect_async(self, pty_id: str, *, directory: str | None = None) -> Response[bool]:
        """Connect to a PTY session (async)."""
        return await self._client.aget(
            "/pty/{ptyID}/connect", path_params={"ptyID": pty_id}, query_params={"directory": directory}
        )


class ConfigApi:
    """Config API endpoints."""

    def __init__(self, client: HttpClient) -> None:
        self._client = client

    def get(self, *, directory: str | None = None) -> Response[Config]:
        """Get config info."""
        return self._client.get("/config", query_params={"directory": directory})

    async def get_async(self, *, directory: str | None = None) -> Response[Config]:
        """Get config info (async)."""
        return await self._client.aget("/config", query_params={"directory": directory})

    def update(
        self, config: Config | None = None, *, directory: str | None = None
    ) -> Response[Config]:
        """Update config."""
        return self._client.patch("/config", body=config, query_params={"directory": directory})

    async def update_async(
        self, config: Config | None = None, *, directory: str | None = None
    ) -> Response[Config]:
        """Update config (async)."""
        return await self._client.apatch(
            "/config", body=config, query_params={"directory": directory}
        )

    def providers(self, *, directory: str | None = None) -> Response[ConfigProvidersResponse]:
        """List all providers."""
        return self._client.get("/config/providers", query_params={"directory": directory})

    async def providers_async(
        self, *, directory: str | None = None
    ) -> Response[ConfigProvidersResponse]:
        """List all providers (async)."""
        return await self._client.aget("/config/providers", query_params={"directory": directory})


class ToolApi:
    """Tool API endpoints."""

    def __init__(self, client: HttpClient) -> None:
        self._client = client

    def ids(self, *, directory: str | None = None) -> Response[ToolIds]:
        """List all tool IDs."""
        return self._client.get("/experimental/tool/ids", query_params={"directory": directory})

    async def ids_async(self, *, directory: str | None = None) -> Response[ToolIds]:
        """List all tool IDs (async)."""
        return await self._client.aget(
            "/experimental/tool/ids", query_params={"directory": directory}
        )

    def list(
        self, *, provider: str, model: str, directory: str | None = None
    ) -> Response[ToolList]:
        """List tools with JSON schema parameters for a provider/model."""
        return self._client.get(
            "/experimental/tool",
            query_params={"provider": provider, "model": model, "directory": directory},
        )

    async def list_async(
        self, *, provider: str, model: str, directory: str | None = None
    ) -> Response[ToolList]:
        """List tools with JSON schema parameters for a provider/model (async)."""
        return await self._client.aget(
            "/experimental/tool",
            query_params={"provider": provider, "model": model, "directory": directory},
        )


class InstanceApi:
    """Instance API endpoints."""

    def __init__(self, client: HttpClient) -> None:
        self._client = client

    def dispose(self, *, directory: str | None = None) -> Response[bool]:
        """Dispose the current instance."""
        return self._client.post("/instance/dispose", query_params={"directory": directory})

    async def dispose_async(self, *, directory: str | None = None) -> Response[bool]:
        """Dispose the current instance (async)."""
        return await self._client.apost("/instance/dispose", query_params={"directory": directory})


class PathApi:
    """Path API endpoints."""

    def __init__(self, client: HttpClient) -> None:
        self._client = client

    def get(self, *, directory: str | None = None) -> Response[PathInfo]:
        """Get the current path."""
        return self._client.get("/path", query_params={"directory": directory})

    async def get_async(self, *, directory: str | None = None) -> Response[PathInfo]:
        """Get the current path (async)."""
        return await self._client.aget("/path", query_params={"directory": directory})


class VcsApi:
    """VCS API endpoints."""

    def __init__(self, client: HttpClient) -> None:
        self._client = client

    def get(self, *, directory: str | None = None) -> Response[VcsInfo]:
        """Get VCS info for the current instance."""
        return self._client.get("/vcs", query_params={"directory": directory})

    async def get_async(self, *, directory: str | None = None) -> Response[VcsInfo]:
        """Get VCS info for the current instance (async)."""
        return await self._client.aget("/vcs", query_params={"directory": directory})


class SessionApi:
    """Session API endpoints."""

    def __init__(self, client: HttpClient) -> None:
        self._client = client

    def list(
        self,
        *,
        start: int | None = None,
        search: str | None = None,
        limit: int | None = None,
        directory: str | None = None,
    ) -> Response[list[Session]]:
        return self._client.get(
            "/session",
            query_params={
                "directory": directory,
                "start": start,
                "search": search,
                "limit": limit,
            },
        )

    async def list_async(
        self,
        *,
        start: int | None = None,
        search: str | None = None,
        limit: int | None = None,
        directory: str | None = None,
    ) -> Response[list[Session]]:
        return await self._client.aget(
            "/session",
            query_params={
                "directory": directory,
                "start": start,
                "search": search,
                "limit": limit,
            },
        )

    def create(
        self,
        *,
        parent_id: str | None = None,
        title: str | None = None,
        permission: PermissionRuleset | None = None,
        directory: str | None = None,
    ) -> Response[Session]:
        """Create a new session."""
        body: dict[str, Any] = {}
        if parent_id is not None:
            body["parentID"] = parent_id
        if title is not None:
            body["title"] = title
        if permission is not None:
            body["permission"] = permission
        return self._client.post(
            "/session", body=body or None, query_params={"directory": directory}
        )

    async def create_async(
        self,
        *,
        parent_id: str | None = None,
        title: str | None = None,
        permission: PermissionRuleset | None = None,
        directory: str | None = None,
    ) -> Response[Session]:
        """Create a new session (async)."""
        body: dict[str, Any] = {}
        if parent_id is not None:
            body["parentID"] = parent_id
        if title is not None:
            body["title"] = title
        if permission is not None:
            body["permission"] = permission
        return await self._client.apost(
            "/session", body=body or None, query_params={"directory": directory}
        )

    def status(self, *, directory: str | None = None) -> Response[dict[str, SessionStatus]]:
        """Get session status."""
        return self._client.get("/session/status", query_params={"directory": directory})

    async def status_async(
        self, *, directory: str | None = None
    ) -> Response[dict[str, SessionStatus]]:
        """Get session status (async)."""
        return await self._client.aget("/session/status", query_params={"directory": directory})

    def delete(self, session_id: str, *, directory: str | None = None) -> Response[bool]:
        """Delete a session and all its data."""
        return self._client.delete(
            "/session/{sessionID}", path_params={"sessionID": session_id}, query_params={"directory": directory}
        )

    async def delete_async(self, session_id: str, *, directory: str | None = None) -> Response[bool]:
        """Delete a session and all its data (async)."""
        return await self._client.adelete(
            "/session/{sessionID}", path_params={"sessionID": session_id}, query_params={"directory": directory}
        )

    def get(self, session_id: str, *, directory: str | None = None) -> Response[Session]:
        """Get session."""
        return self._client.get(
            "/session/{sessionID}", path_params={"sessionID": session_id}, query_params={"directory": directory}
        )

    async def get_async(self, session_id: str, *, directory: str | None = None) -> Response[Session]:
        """Get session (async)."""
        return await self._client.aget(
            "/session/{sessionID}", path_params={"sessionID": session_id}, query_params={"directory": directory}
        )

    def update(
        self,
        session_id: str,
        *,
        title: str | None = None,
        time: dict[str, int] | None = None,
        directory: str | None = None,
    ) -> Response[Session]:
        body: dict[str, Any] = {}
        if title is not None:
            body["title"] = title
        if time is not None:
            body["time"] = time
        return self._client.patch(
            "/session/{sessionID}",
            path_params={"sessionID": session_id},
            body=body or None,
            query_params={"directory": directory},
        )

    async def update_async(
        self,
        session_id: str,
        *,
        title: str | None = None,
        time: dict[str, int] | None = None,
        directory: str | None = None,
    ) -> Response[Session]:
        body: dict[str, Any] = {}
        if title is not None:
            body["title"] = title
        if time is not None:
            body["time"] = time
        return await self._client.apatch(
            "/session/{sessionID}",
            path_params={"sessionID": session_id},
            body=body or None,
            query_params={"directory": directory},
        )

    def children(self, session_id: str, *, directory: str | None = None) -> Response[list[Session]]:
        """Get a session's children."""
        return self._client.get(
            "/session/{sessionID}/children", path_params={"sessionID": session_id}, query_params={"directory": directory}
        )

    async def children_async(
        self, session_id: str, *, directory: str | None = None
    ) -> Response[list[Session]]:
        """Get a session's children (async)."""
        return await self._client.aget(
            "/session/{sessionID}/children", path_params={"sessionID": session_id}, query_params={"directory": directory}
        )

    def todo(self, session_id: str, *, directory: str | None = None) -> Response[list[Todo]]:
        """Get the todo list for a session."""
        return self._client.get(
            "/session/{sessionID}/todo", path_params={"sessionID": session_id}, query_params={"directory": directory}
        )

    async def todo_async(self, session_id: str, *, directory: str | None = None) -> Response[list[Todo]]:
        """Get the todo list for a session (async)."""
        return await self._client.aget(
            "/session/{sessionID}/todo", path_params={"sessionID": session_id}, query_params={"directory": directory}
        )

    def init(
        self,
        session_id: str,
        *,
        model_id: str,
        provider_id: str,
        message_id: str,
        directory: str | None = None,
    ) -> Response[bool]:
        """Analyze the app and create an AGENTS.md file."""
        body = {"modelID": model_id, "providerID": provider_id, "messageID": message_id}
        return self._client.post(
            "/session/{sessionID}/init",
            path_params={"sessionID": session_id},
            body=body,
            query_params={"directory": directory},
        )

    async def init_async(
        self,
        session_id: str,
        *,
        model_id: str,
        provider_id: str,
        message_id: str,
        directory: str | None = None,
    ) -> Response[bool]:
        """Analyze the app and create an AGENTS.md file (async)."""
        body = {"modelID": model_id, "providerID": provider_id, "messageID": message_id}
        return await self._client.apost(
            "/session/{sessionID}/init",
            path_params={"sessionID": session_id},
            body=body,
            query_params={"directory": directory},
        )

    def fork(
        self, session_id: str, *, message_id: str | None = None, directory: str | None = None
    ) -> Response[Session]:
        """Fork an existing session at a specific message."""
        body: dict[str, Any] = {}
        if message_id is not None:
            body["messageID"] = message_id
        return self._client.post(
            "/session/{sessionID}/fork",
            path_params={"sessionID": session_id},
            body=body or None,
            query_params={"directory": directory},
        )

    async def fork_async(
        self, session_id: str, *, message_id: str | None = None, directory: str | None = None
    ) -> Response[Session]:
        """Fork an existing session at a specific message (async)."""
        body: dict[str, Any] = {}
        if message_id is not None:
            body["messageID"] = message_id
        return await self._client.apost(
            "/session/{sessionID}/fork",
            path_params={"sessionID": session_id},
            body=body or None,
            query_params={"directory": directory},
        )

    def abort(self, session_id: str, *, directory: str | None = None) -> Response[bool]:
        """Abort a session."""
        return self._client.post(
            "/session/{sessionID}/abort", path_params={"sessionID": session_id}, query_params={"directory": directory}
        )

    async def abort_async(self, session_id: str, *, directory: str | None = None) -> Response[bool]:
        """Abort a session (async)."""
        return await self._client.apost(
            "/session/{sessionID}/abort", path_params={"sessionID": session_id}, query_params={"directory": directory}
        )

    def unshare(self, session_id: str, *, directory: str | None = None) -> Response[Session]:
        """Unshare the session."""
        return self._client.delete(
            "/session/{sessionID}/share", path_params={"sessionID": session_id}, query_params={"directory": directory}
        )

    async def unshare_async(self, session_id: str, *, directory: str | None = None) -> Response[Session]:
        """Unshare the session (async)."""
        return await self._client.adelete(
            "/session/{sessionID}/share", path_params={"sessionID": session_id}, query_params={"directory": directory}
        )

    def share(self, session_id: str, *, directory: str | None = None) -> Response[Session]:
        """Share a session."""
        return self._client.post(
            "/session/{sessionID}/share", path_params={"sessionID": session_id}, query_params={"directory": directory}
        )

    async def share_async(self, session_id: str, *, directory: str | None = None) -> Response[Session]:
        """Share a session (async)."""
        return await self._client.apost(
            "/session/{sessionID}/share", path_params={"sessionID": session_id}, query_params={"directory": directory}
        )

    def diff(
        self, session_id: str, *, message_id: str | None = None, directory: str | None = None
    ) -> Response[list[FileDiff]]:
        """Get the diff for this session."""
        return self._client.get(
            "/session/{sessionID}/diff",
            path_params={"sessionID": session_id},
            query_params={"messageID": message_id, "directory": directory},
        )

    async def diff_async(
        self, session_id: str, *, message_id: str | None = None, directory: str | None = None
    ) -> Response[list[FileDiff]]:
        """Get the diff for this session (async)."""
        return await self._client.aget(
            "/session/{sessionID}/diff",
            path_params={"sessionID": session_id},
            query_params={"messageID": message_id, "directory": directory},
        )

    def summarize(
        self, session_id: str, *, provider_id: str, model_id: str, directory: str | None = None
    ) -> Response[bool]:
        """Summarize the session."""
        body = {"providerID": provider_id, "modelID": model_id}
        return self._client.post(
            "/session/{sessionID}/summarize",
            path_params={"sessionID": session_id},
            body=body,
            query_params={"directory": directory},
        )

    async def summarize_async(
        self, session_id: str, *, provider_id: str, model_id: str, directory: str | None = None
    ) -> Response[bool]:
        """Summarize the session (async)."""
        body = {"providerID": provider_id, "modelID": model_id}
        return await self._client.apost(
            "/session/{sessionID}/summarize",
            path_params={"sessionID": session_id},
            body=body,
            query_params={"directory": directory},
        )

    def messages(
        self, session_id: str, *, limit: int | None = None, directory: str | None = None
    ) -> Response[list[MessageWithParts]]:
        """List messages for a session."""
        return self._client.get(
            "/session/{sessionID}/message",
            path_params={"sessionID": session_id},
            query_params={"limit": limit, "directory": directory},
        )

    async def messages_async(
        self, session_id: str, *, limit: int | None = None, directory: str | None = None
    ) -> Response[list[MessageWithParts]]:
        """List messages for a session (async)."""
        return await self._client.aget(
            "/session/{sessionID}/message",
            path_params={"sessionID": session_id},
            query_params={"limit": limit, "directory": directory},
        )

    def prompt(
        self,
        session_id: str,
        *,
        parts: list[PartInput],
        message_id: str | None = None,
        model: dict[str, str] | None = None,
        agent: str | None = None,
        no_reply: bool | None = None,
        system: str | None = None,
        tools: dict[str, bool] | None = None,
        directory: str | None = None,
    ) -> Response[AssistantMessageWithParts]:
        """Create and send a new message to a session."""
        body: dict[str, Any] = {"parts": parts}
        if message_id is not None:
            body["messageID"] = message_id
        if model is not None:
            body["model"] = model
        if agent is not None:
            body["agent"] = agent
        if no_reply is not None:
            body["noReply"] = no_reply
        if system is not None:
            body["system"] = system
        if tools is not None:
            body["tools"] = tools
        return self._client.post(
            "/session/{sessionID}/message",
            path_params={"sessionID": session_id},
            body=body,
            query_params={"directory": directory},
        )

    async def prompt_async(
        self,
        session_id: str,
        *,
        parts: list[PartInput],
        message_id: str | None = None,
        model: dict[str, str] | None = None,
        agent: str | None = None,
        no_reply: bool | None = None,
        system: str | None = None,
        tools: dict[str, bool] | None = None,
        directory: str | None = None,
    ) -> Response[AssistantMessageWithParts]:
        """Create and send a new message to a session (async)."""
        body: dict[str, Any] = {"parts": parts}
        if message_id is not None:
            body["messageID"] = message_id
        if model is not None:
            body["model"] = model
        if agent is not None:
            body["agent"] = agent
        if no_reply is not None:
            body["noReply"] = no_reply
        if system is not None:
            body["system"] = system
        if tools is not None:
            body["tools"] = tools
        return await self._client.apost(
            "/session/{sessionID}/message",
            path_params={"sessionID": session_id},
            body=body,
            query_params={"directory": directory},
        )

    def message(
        self, session_id: str, message_id: str, *, directory: str | None = None
    ) -> Response[MessageWithParts]:
        """Get a message from a session."""
        return self._client.get(
            "/session/{sessionID}/message/{messageID}",
            path_params={"sessionID": session_id, "messageID": message_id},
            query_params={"directory": directory},
        )

    async def message_async(
        self, session_id: str, message_id: str, *, directory: str | None = None
    ) -> Response[MessageWithParts]:
        """Get a message from a session (async)."""
        return await self._client.aget(
            "/session/{sessionID}/message/{messageID}",
            path_params={"sessionID": session_id, "messageID": message_id},
            query_params={"directory": directory},
        )

    def prompt_async_fire(
        self,
        session_id: str,
        *,
        parts: list[PartInput],
        message_id: str | None = None,
        model: dict[str, str] | None = None,
        agent: str | None = None,
        no_reply: bool | None = None,
        system: str | None = None,
        tools: dict[str, bool] | None = None,
        directory: str | None = None,
    ) -> Response[None]:
        """Create and send a new message to a session, start if needed and return immediately."""
        body: dict[str, Any] = {"parts": parts}
        if message_id is not None:
            body["messageID"] = message_id
        if model is not None:
            body["model"] = model
        if agent is not None:
            body["agent"] = agent
        if no_reply is not None:
            body["noReply"] = no_reply
        if system is not None:
            body["system"] = system
        if tools is not None:
            body["tools"] = tools
        return self._client.post(
            "/session/{sessionID}/prompt_async",
            path_params={"sessionID": session_id},
            body=body,
            query_params={"directory": directory},
        )

    async def prompt_async_fire_async(
        self,
        session_id: str,
        *,
        parts: list[PartInput],
        message_id: str | None = None,
        model: dict[str, str] | None = None,
        agent: str | None = None,
        no_reply: bool | None = None,
        system: str | None = None,
        tools: dict[str, bool] | None = None,
        directory: str | None = None,
    ) -> Response[None]:
        """Create and send a new message, start if needed and return immediately (async)."""
        body: dict[str, Any] = {"parts": parts}
        if message_id is not None:
            body["messageID"] = message_id
        if model is not None:
            body["model"] = model
        if agent is not None:
            body["agent"] = agent
        if no_reply is not None:
            body["noReply"] = no_reply
        if system is not None:
            body["system"] = system
        if tools is not None:
            body["tools"] = tools
        return await self._client.apost(
            "/session/{sessionID}/prompt_async",
            path_params={"sessionID": session_id},
            body=body,
            query_params={"directory": directory},
        )

    def command(
        self,
        session_id: str,
        *,
        command: str,
        arguments: str,
        message_id: str | None = None,
        agent: str | None = None,
        model: str | None = None,
        directory: str | None = None,
    ) -> Response[AssistantMessageWithParts]:
        """Send a new command to a session."""
        body: dict[str, Any] = {"command": command, "arguments": arguments}
        if message_id is not None:
            body["messageID"] = message_id
        if agent is not None:
            body["agent"] = agent
        if model is not None:
            body["model"] = model
        return self._client.post(
            "/session/{sessionID}/command",
            path_params={"sessionID": session_id},
            body=body,
            query_params={"directory": directory},
        )

    async def command_async(
        self,
        session_id: str,
        *,
        command: str,
        arguments: str,
        message_id: str | None = None,
        agent: str | None = None,
        model: str | None = None,
        directory: str | None = None,
    ) -> Response[AssistantMessageWithParts]:
        """Send a new command to a session (async)."""
        body: dict[str, Any] = {"command": command, "arguments": arguments}
        if message_id is not None:
            body["messageID"] = message_id
        if agent is not None:
            body["agent"] = agent
        if model is not None:
            body["model"] = model
        return await self._client.apost(
            "/session/{sessionID}/command",
            path_params={"sessionID": session_id},
            body=body,
            query_params={"directory": directory},
        )

    def shell(
        self,
        session_id: str,
        *,
        agent: str,
        command: str,
        model: dict[str, str] | None = None,
        directory: str | None = None,
    ) -> Response[Any]:
        """Run a shell command."""
        body: dict[str, Any] = {"agent": agent, "command": command}
        if model is not None:
            body["model"] = model
        return self._client.post(
            "/session/{sessionID}/shell",
            path_params={"sessionID": session_id},
            body=body,
            query_params={"directory": directory},
        )

    async def shell_async(
        self,
        session_id: str,
        *,
        agent: str,
        command: str,
        model: dict[str, str] | None = None,
        directory: str | None = None,
    ) -> Response[Any]:
        """Run a shell command (async)."""
        body: dict[str, Any] = {"agent": agent, "command": command}
        if model is not None:
            body["model"] = model
        return await self._client.apost(
            "/session/{sessionID}/shell",
            path_params={"sessionID": session_id},
            body=body,
            query_params={"directory": directory},
        )

    def revert(
        self,
        session_id: str,
        *,
        message_id: str,
        part_id: str | None = None,
        directory: str | None = None,
    ) -> Response[Session]:
        """Revert a message."""
        body: dict[str, Any] = {"messageID": message_id}
        if part_id is not None:
            body["partID"] = part_id
        return self._client.post(
            "/session/{sessionID}/revert",
            path_params={"sessionID": session_id},
            body=body,
            query_params={"directory": directory},
        )

    async def revert_async(
        self,
        session_id: str,
        *,
        message_id: str,
        part_id: str | None = None,
        directory: str | None = None,
    ) -> Response[Session]:
        """Revert a message (async)."""
        body: dict[str, Any] = {"messageID": message_id}
        if part_id is not None:
            body["partID"] = part_id
        return await self._client.apost(
            "/session/{sessionID}/revert",
            path_params={"sessionID": session_id},
            body=body,
            query_params={"directory": directory},
        )

    def unrevert(self, session_id: str, *, directory: str | None = None) -> Response[Session]:
        """Restore all reverted messages."""
        return self._client.post(
            "/session/{sessionID}/unrevert", path_params={"sessionID": session_id}, query_params={"directory": directory}
        )

    async def unrevert_async(self, session_id: str, *, directory: str | None = None) -> Response[Session]:
        """Restore all reverted messages (async)."""
        return await self._client.apost(
            "/session/{sessionID}/unrevert", path_params={"sessionID": session_id}, query_params={"directory": directory}
        )

    def permission_respond(
        self,
        session_id: str,
        permission_id: str,
        *,
        response: Literal["once", "always", "reject"],
        directory: str | None = None,
    ) -> Response[bool]:
        """Respond to a permission request."""
        body = {"response": response}
        return self._client.post(
            "/session/{sessionID}/permissions/{permissionID}",
            path_params={"sessionID": session_id, "permissionID": permission_id},
            body=body,
            query_params={"directory": directory},
        )

    async def permission_respond_async(
        self,
        session_id: str,
        permission_id: str,
        *,
        response: Literal["once", "always", "reject"],
        directory: str | None = None,
    ) -> Response[bool]:
        """Respond to a permission request (async)."""
        body = {"response": response}
        return await self._client.apost(
            "/session/{sessionID}/permissions/{permissionID}",
            path_params={"sessionID": session_id, "permissionID": permission_id},
            body=body,
            query_params={"directory": directory},
        )


class PartApi:

    def __init__(self, client: HttpClient) -> None:
        self._client = client

    def delete(
        self,
        session_id: str,
        message_id: str,
        part_id: str,
        *,
        directory: str | None = None,
    ) -> Response[bool]:
        return self._client.delete(
            "/session/{sessionID}/message/{messageID}/part/{partID}",
            path_params={"sessionID": session_id, "messageID": message_id, "partID": part_id},
            query_params={"directory": directory},
        )

    async def delete_async(
        self,
        session_id: str,
        message_id: str,
        part_id: str,
        *,
        directory: str | None = None,
    ) -> Response[bool]:
        return await self._client.adelete(
            "/session/{sessionID}/message/{messageID}/part/{partID}",
            path_params={"sessionID": session_id, "messageID": message_id, "partID": part_id},
            query_params={"directory": directory},
        )

    def update(
        self,
        session_id: str,
        message_id: str,
        part_id: str,
        part: Part,
        *,
        directory: str | None = None,
    ) -> Response[Part]:
        return self._client.patch(
            "/session/{sessionID}/message/{messageID}/part/{partID}",
            path_params={"sessionID": session_id, "messageID": message_id, "partID": part_id},
            body=part,
            query_params={"directory": directory},
        )

    async def update_async(
        self,
        session_id: str,
        message_id: str,
        part_id: str,
        part: Part,
        *,
        directory: str | None = None,
    ) -> Response[Part]:
        return await self._client.apatch(
            "/session/{sessionID}/message/{messageID}/part/{partID}",
            path_params={"sessionID": session_id, "messageID": message_id, "partID": part_id},
            body=part,
            query_params={"directory": directory},
        )


class PermissionApi:

    def __init__(self, client: HttpClient) -> None:
        self._client = client

    def list(self, *, directory: str | None = None) -> Response[list[PermissionRequest]]:
        return self._client.get("/permission", query_params={"directory": directory})

    async def list_async(self, *, directory: str | None = None) -> Response[list[PermissionRequest]]:
        return await self._client.aget("/permission", query_params={"directory": directory})

    def reply(
        self,
        request_id: str,
        *,
        reply: Literal["once", "always", "reject"],
        message: str | None = None,
        directory: str | None = None,
    ) -> Response[bool]:
        body: dict[str, Any] = {"reply": reply}
        if message is not None:
            body["message"] = message
        return self._client.post(
            "/permission/{requestID}/reply",
            path_params={"requestID": request_id},
            body=body,
            query_params={"directory": directory},
        )

    async def reply_async(
        self,
        request_id: str,
        *,
        reply: Literal["once", "always", "reject"],
        message: str | None = None,
        directory: str | None = None,
    ) -> Response[bool]:
        body: dict[str, Any] = {"reply": reply}
        if message is not None:
            body["message"] = message
        return await self._client.apost(
            "/permission/{requestID}/reply",
            path_params={"requestID": request_id},
            body=body,
            query_params={"directory": directory},
        )

    def respond(
        self,
        session_id: str,
        permission_id: str,
        *,
        response: Literal["once", "always", "reject"],
        directory: str | None = None,
    ) -> Response[bool]:
        body = {"response": response}
        return self._client.post(
            "/session/{sessionID}/permissions/{permissionID}",
            path_params={"sessionID": session_id, "permissionID": permission_id},
            body=body,
            query_params={"directory": directory},
        )

    async def respond_async(
        self,
        session_id: str,
        permission_id: str,
        *,
        response: Literal["once", "always", "reject"],
        directory: str | None = None,
    ) -> Response[bool]:
        body = {"response": response}
        return await self._client.apost(
            "/session/{sessionID}/permissions/{permissionID}",
            path_params={"sessionID": session_id, "permissionID": permission_id},
            body=body,
            query_params={"directory": directory},
        )


class QuestionApi:

    def __init__(self, client: HttpClient) -> None:
        self._client = client

    def list(self, *, directory: str | None = None) -> Response[list[QuestionRequest]]:
        return self._client.get("/question", query_params={"directory": directory})

    async def list_async(self, *, directory: str | None = None) -> Response[list[QuestionRequest]]:
        return await self._client.aget("/question", query_params={"directory": directory})

    def reply(
        self,
        request_id: str,
        *,
        answers: list[QuestionAnswer],
        directory: str | None = None,
    ) -> Response[bool]:
        body = {"answers": answers}
        return self._client.post(
            "/question/{requestID}/reply",
            path_params={"requestID": request_id},
            body=body,
            query_params={"directory": directory},
        )

    async def reply_async(
        self,
        request_id: str,
        *,
        answers: list[QuestionAnswer],
        directory: str | None = None,
    ) -> Response[bool]:
        body = {"answers": answers}
        return await self._client.apost(
            "/question/{requestID}/reply",
            path_params={"requestID": request_id},
            body=body,
            query_params={"directory": directory},
        )

    def reject(
        self,
        request_id: str,
        *,
        directory: str | None = None,
    ) -> Response[bool]:
        return self._client.post(
            "/question/{requestID}/reject",
            path_params={"requestID": request_id},
            query_params={"directory": directory},
        )

    async def reject_async(
        self,
        request_id: str,
        *,
        directory: str | None = None,
    ) -> Response[bool]:
        return await self._client.apost(
            "/question/{requestID}/reject",
            path_params={"requestID": request_id},
            query_params={"directory": directory},
        )


class WorktreeApi:

    def __init__(self, client: HttpClient) -> None:
        self._client = client

    def list(self, *, directory: str | None = None) -> Response[list[str]]:
        return self._client.get("/experimental/worktree", query_params={"directory": directory})

    async def list_async(self, *, directory: str | None = None) -> Response[list[str]]:
        return await self._client.aget("/experimental/worktree", query_params={"directory": directory})

    def create(
        self,
        *,
        name: str | None = None,
        start_command: str | None = None,
        directory: str | None = None,
    ) -> Response[Worktree]:
        body: dict[str, Any] = {}
        if name is not None:
            body["name"] = name
        if start_command is not None:
            body["startCommand"] = start_command
        return self._client.post(
            "/experimental/worktree",
            body=body or None,
            query_params={"directory": directory},
        )

    async def create_async(
        self,
        *,
        name: str | None = None,
        start_command: str | None = None,
        directory: str | None = None,
    ) -> Response[Worktree]:
        body: dict[str, Any] = {}
        if name is not None:
            body["name"] = name
        if start_command is not None:
            body["startCommand"] = start_command
        return await self._client.apost(
            "/experimental/worktree",
            body=body or None,
            query_params={"directory": directory},
        )


class ResourceApi:

    def __init__(self, client: HttpClient) -> None:
        self._client = client

    def list(self, *, directory: str | None = None) -> Response[list[McpResource]]:
        return self._client.get("/experimental/resource", query_params={"directory": directory})

    async def list_async(self, *, directory: str | None = None) -> Response[list[McpResource]]:
        return await self._client.aget("/experimental/resource", query_params={"directory": directory})


class ExperimentalApi:

    def __init__(self, client: HttpClient) -> None:
        self._client = client
        self.resource = ResourceApi(client)


class CommandApi:

    def __init__(self, client: HttpClient) -> None:
        self._client = client

    def list(self, *, directory: str | None = None) -> Response[list[Command]]:
        return self._client.get("/command", query_params={"directory": directory})

    async def list_async(self, *, directory: str | None = None) -> Response[list[Command]]:
        """List all commands (async)."""
        return await self._client.aget("/command", query_params={"directory": directory})


class OAuthApi:
    """OAuth API endpoints."""

    def __init__(self, client: HttpClient) -> None:
        self._client = client

    def authorize(
        self, provider_id: str, *, method: int, directory: str | None = None
    ) -> Response[ProviderAuthAuthorization]:
        """Authorize a provider using OAuth."""
        body = {"method": method}
        return self._client.post(
            "/provider/{providerID}/oauth/authorize",
            path_params={"providerID": provider_id},
            body=body,
            query_params={"directory": directory},
        )

    async def authorize_async(
        self, provider_id: str, *, method: int, directory: str | None = None
    ) -> Response[ProviderAuthAuthorization]:
        """Authorize a provider using OAuth (async)."""
        body = {"method": method}
        return await self._client.apost(
            "/provider/{providerID}/oauth/authorize",
            path_params={"providerID": provider_id},
            body=body,
            query_params={"directory": directory},
        )

    def callback(
        self, provider_id: str, *, method: int, code: str | None = None, directory: str | None = None
    ) -> Response[bool]:
        """Handle OAuth callback for a provider."""
        body: dict[str, Any] = {"method": method}
        if code is not None:
            body["code"] = code
        return self._client.post(
            "/provider/{providerID}/oauth/callback",
            path_params={"providerID": provider_id},
            body=body,
            query_params={"directory": directory},
        )

    async def callback_async(
        self, provider_id: str, *, method: int, code: str | None = None, directory: str | None = None
    ) -> Response[bool]:
        """Handle OAuth callback for a provider (async)."""
        body: dict[str, Any] = {"method": method}
        if code is not None:
            body["code"] = code
        return await self._client.apost(
            "/provider/{providerID}/oauth/callback",
            path_params={"providerID": provider_id},
            body=body,
            query_params={"directory": directory},
        )


class ProviderApi:
    """Provider API endpoints."""

    def __init__(self, client: HttpClient) -> None:
        self._client = client
        self.oauth = OAuthApi(client)

    def list(self, *, directory: str | None = None) -> Response[ProviderListResponse]:
        """List all providers."""
        return self._client.get("/provider", query_params={"directory": directory})

    async def list_async(self, *, directory: str | None = None) -> Response[ProviderListResponse]:
        """List all providers (async)."""
        return await self._client.aget("/provider", query_params={"directory": directory})

    def auth(
        self, *, directory: str | None = None
    ) -> Response[dict[str, list[ProviderAuthMethod]]]:
        """Get provider authentication methods."""
        return self._client.get("/provider/auth", query_params={"directory": directory})

    async def auth_async(
        self, *, directory: str | None = None
    ) -> Response[dict[str, list[ProviderAuthMethod]]]:
        """Get provider authentication methods (async)."""
        return await self._client.aget("/provider/auth", query_params={"directory": directory})


class FindApi:
    """Find API endpoints."""

    def __init__(self, client: HttpClient) -> None:
        self._client = client

    def text(self, *, pattern: str, directory: str | None = None) -> Response[list[FindMatch]]:
        """Find text in files."""
        return self._client.get(
            "/find", query_params={"pattern": pattern, "directory": directory}
        )

    async def text_async(
        self, *, pattern: str, directory: str | None = None
    ) -> Response[list[FindMatch]]:
        """Find text in files (async)."""
        return await self._client.aget(
            "/find", query_params={"pattern": pattern, "directory": directory}
        )

    def files(
        self, *, query: str, dirs: bool | None = None, directory: str | None = None
    ) -> Response[list[str]]:
        """Find files."""
        query_params: dict[str, Any] = {"query": query, "directory": directory}
        if dirs is not None:
            query_params["dirs"] = "true" if dirs else "false"
        return self._client.get("/find/file", query_params=query_params)

    async def files_async(
        self, *, query: str, dirs: bool | None = None, directory: str | None = None
    ) -> Response[list[str]]:
        """Find files (async)."""
        query_params: dict[str, Any] = {"query": query, "directory": directory}
        if dirs is not None:
            query_params["dirs"] = "true" if dirs else "false"
        return await self._client.aget("/find/file", query_params=query_params)

    def symbols(self, *, query: str, directory: str | None = None) -> Response[list[Symbol]]:
        """Find workspace symbols."""
        return self._client.get(
            "/find/symbol", query_params={"query": query, "directory": directory}
        )

    async def symbols_async(
        self, *, query: str, directory: str | None = None
    ) -> Response[list[Symbol]]:
        """Find workspace symbols (async)."""
        return await self._client.aget(
            "/find/symbol", query_params={"query": query, "directory": directory}
        )


class FileApi:
    """File API endpoints."""

    def __init__(self, client: HttpClient) -> None:
        self._client = client

    def list(self, *, path: str, directory: str | None = None) -> Response[list[FileNode]]:
        """List files and directories."""
        return self._client.get("/file", query_params={"path": path, "directory": directory})

    async def list_async(
        self, *, path: str, directory: str | None = None
    ) -> Response[list[FileNode]]:
        """List files and directories (async)."""
        return await self._client.aget(
            "/file", query_params={"path": path, "directory": directory}
        )

    def read(self, *, path: str, directory: str | None = None) -> Response[FileContent]:
        """Read a file."""
        return self._client.get(
            "/file/content", query_params={"path": path, "directory": directory}
        )

    async def read_async(
        self, *, path: str, directory: str | None = None
    ) -> Response[FileContent]:
        """Read a file (async)."""
        return await self._client.aget(
            "/file/content", query_params={"path": path, "directory": directory}
        )

    def status(self, *, directory: str | None = None) -> Response[list[FileStatus]]:
        """Get file status."""
        return self._client.get("/file/status", query_params={"directory": directory})

    async def status_async(self, *, directory: str | None = None) -> Response[list[FileStatus]]:
        """Get file status (async)."""
        return await self._client.aget("/file/status", query_params={"directory": directory})


class AppApi:
    """App API endpoints."""

    def __init__(self, client: HttpClient) -> None:
        self._client = client

    def log(
        self,
        *,
        service: str,
        level: Literal["debug", "info", "error", "warn"],
        message: str,
        extra: dict[str, Any] | None = None,
        directory: str | None = None,
    ) -> Response[bool]:
        """Write a log entry to the server logs."""
        body: dict[str, Any] = {"service": service, "level": level, "message": message}
        if extra is not None:
            body["extra"] = extra
        return self._client.post("/log", body=body, query_params={"directory": directory})

    async def log_async(
        self,
        *,
        service: str,
        level: Literal["debug", "info", "error", "warn"],
        message: str,
        extra: dict[str, Any] | None = None,
        directory: str | None = None,
    ) -> Response[bool]:
        """Write a log entry to the server logs (async)."""
        body: dict[str, Any] = {"service": service, "level": level, "message": message}
        if extra is not None:
            body["extra"] = extra
        return await self._client.apost("/log", body=body, query_params={"directory": directory})

    def agents(self, *, directory: str | None = None) -> Response[list[Agent]]:
        """List all agents."""
        return self._client.get("/agent", query_params={"directory": directory})

    async def agents_async(self, *, directory: str | None = None) -> Response[list[Agent]]:
        """List all agents (async)."""
        return await self._client.aget("/agent", query_params={"directory": directory})


class McpAuthApi:
    """MCP Auth API endpoints."""

    def __init__(self, client: HttpClient) -> None:
        self._client = client

    def remove(self, name: str, *, directory: str | None = None) -> Response[dict[str, bool]]:
        """Remove OAuth credentials for an MCP server."""
        return self._client.delete(
            "/mcp/{name}/auth", path_params={"name": name}, query_params={"directory": directory}
        )

    async def remove_async(
        self, name: str, *, directory: str | None = None
    ) -> Response[dict[str, bool]]:
        """Remove OAuth credentials for an MCP server (async)."""
        return await self._client.adelete(
            "/mcp/{name}/auth", path_params={"name": name}, query_params={"directory": directory}
        )

    def start(
        self, name: str, *, directory: str | None = None
    ) -> Response[dict[str, str]]:
        """Start OAuth authentication flow for an MCP server."""
        return self._client.post(
            "/mcp/{name}/auth", path_params={"name": name}, query_params={"directory": directory}
        )

    async def start_async(
        self, name: str, *, directory: str | None = None
    ) -> Response[dict[str, str]]:
        """Start OAuth authentication flow for an MCP server (async)."""
        return await self._client.apost(
            "/mcp/{name}/auth", path_params={"name": name}, query_params={"directory": directory}
        )

    def callback(
        self, name: str, *, code: str, directory: str | None = None
    ) -> Response[McpStatus]:
        """Complete OAuth authentication with authorization code."""
        body = {"code": code}
        return self._client.post(
            "/mcp/{name}/auth/callback",
            path_params={"name": name},
            body=body,
            query_params={"directory": directory},
        )

    async def callback_async(
        self, name: str, *, code: str, directory: str | None = None
    ) -> Response[McpStatus]:
        """Complete OAuth authentication with authorization code (async)."""
        body = {"code": code}
        return await self._client.apost(
            "/mcp/{name}/auth/callback",
            path_params={"name": name},
            body=body,
            query_params={"directory": directory},
        )

    def authenticate(self, name: str, *, directory: str | None = None) -> Response[McpStatus]:
        """Start OAuth flow and wait for callback (opens browser)."""
        return self._client.post(
            "/mcp/{name}/auth/authenticate",
            path_params={"name": name},
            query_params={"directory": directory},
        )

    async def authenticate_async(
        self, name: str, *, directory: str | None = None
    ) -> Response[McpStatus]:
        """Start OAuth flow and wait for callback (opens browser) (async)."""
        return await self._client.apost(
            "/mcp/{name}/auth/authenticate",
            path_params={"name": name},
            query_params={"directory": directory},
        )


class McpApi:
    """MCP API endpoints."""

    def __init__(self, client: HttpClient) -> None:
        self._client = client
        self.auth = McpAuthApi(client)

    def status(self, *, directory: str | None = None) -> Response[dict[str, McpStatus]]:
        """Get MCP server status."""
        return self._client.get("/mcp", query_params={"directory": directory})

    async def status_async(
        self, *, directory: str | None = None
    ) -> Response[dict[str, McpStatus]]:
        """Get MCP server status (async)."""
        return await self._client.aget("/mcp", query_params={"directory": directory})

    def add(
        self, *, name: str, config: McpConfig, directory: str | None = None
    ) -> Response[dict[str, McpStatus]]:
        """Add MCP server dynamically."""
        body = {"name": name, "config": config}
        return self._client.post("/mcp", body=body, query_params={"directory": directory})

    async def add_async(
        self, *, name: str, config: McpConfig, directory: str | None = None
    ) -> Response[dict[str, McpStatus]]:
        """Add MCP server dynamically (async)."""
        body = {"name": name, "config": config}
        return await self._client.apost("/mcp", body=body, query_params={"directory": directory})

    def connect(self, name: str, *, directory: str | None = None) -> Response[bool]:
        """Connect an MCP server."""
        return self._client.post(
            "/mcp/{name}/connect",
            path_params={"name": name},
            query_params={"directory": directory},
        )

    async def connect_async(self, name: str, *, directory: str | None = None) -> Response[bool]:
        """Connect an MCP server (async)."""
        return await self._client.apost(
            "/mcp/{name}/connect",
            path_params={"name": name},
            query_params={"directory": directory},
        )

    def disconnect(self, name: str, *, directory: str | None = None) -> Response[bool]:
        """Disconnect an MCP server."""
        return self._client.post(
            "/mcp/{name}/disconnect",
            path_params={"name": name},
            query_params={"directory": directory},
        )

    async def disconnect_async(self, name: str, *, directory: str | None = None) -> Response[bool]:
        """Disconnect an MCP server (async)."""
        return await self._client.apost(
            "/mcp/{name}/disconnect",
            path_params={"name": name},
            query_params={"directory": directory},
        )


class LspApi:
    """LSP API endpoints."""

    def __init__(self, client: HttpClient) -> None:
        self._client = client

    def status(self, *, directory: str | None = None) -> Response[list[LspStatus]]:
        """Get LSP server status."""
        return self._client.get("/lsp", query_params={"directory": directory})

    async def status_async(self, *, directory: str | None = None) -> Response[list[LspStatus]]:
        """Get LSP server status (async)."""
        return await self._client.aget("/lsp", query_params={"directory": directory})


class FormatterApi:
    """Formatter API endpoints."""

    def __init__(self, client: HttpClient) -> None:
        self._client = client

    def status(self, *, directory: str | None = None) -> Response[list[FormatterStatus]]:
        """Get formatter status."""
        return self._client.get("/formatter", query_params={"directory": directory})

    async def status_async(
        self, *, directory: str | None = None
    ) -> Response[list[FormatterStatus]]:
        """Get formatter status (async)."""
        return await self._client.aget("/formatter", query_params={"directory": directory})


class TuiControlApi:
    """TUI Control API endpoints."""

    def __init__(self, client: HttpClient) -> None:
        self._client = client

    def next(self, *, directory: str | None = None) -> Response[TuiControlNextResponse]:
        """Get the next TUI request from the queue."""
        return self._client.get("/tui/control/next", query_params={"directory": directory})

    async def next_async(
        self, *, directory: str | None = None
    ) -> Response[TuiControlNextResponse]:
        """Get the next TUI request from the queue (async)."""
        return await self._client.aget("/tui/control/next", query_params={"directory": directory})

    def response(self, body: Any = None, *, directory: str | None = None) -> Response[bool]:
        """Submit a response to the TUI request queue."""
        return self._client.post(
            "/tui/control/response", body=body, query_params={"directory": directory}
        )

    async def response_async(
        self, body: Any = None, *, directory: str | None = None
    ) -> Response[bool]:
        """Submit a response to the TUI request queue (async)."""
        return await self._client.apost(
            "/tui/control/response", body=body, query_params={"directory": directory}
        )


class TuiApi:
    """TUI API endpoints."""

    def __init__(self, client: HttpClient) -> None:
        self._client = client
        self.control = TuiControlApi(client)

    def append_prompt(
        self, *, text: str, directory: str | None = None
    ) -> Response[bool]:
        """Append prompt to the TUI."""
        body = {"text": text}
        return self._client.post(
            "/tui/append-prompt", body=body, query_params={"directory": directory}
        )

    async def append_prompt_async(
        self, *, text: str, directory: str | None = None
    ) -> Response[bool]:
        """Append prompt to the TUI (async)."""
        body = {"text": text}
        return await self._client.apost(
            "/tui/append-prompt", body=body, query_params={"directory": directory}
        )

    def open_help(self, *, directory: str | None = None) -> Response[bool]:
        """Open the help dialog."""
        return self._client.post("/tui/open-help", query_params={"directory": directory})

    async def open_help_async(self, *, directory: str | None = None) -> Response[bool]:
        """Open the help dialog (async)."""
        return await self._client.apost("/tui/open-help", query_params={"directory": directory})

    def open_sessions(self, *, directory: str | None = None) -> Response[bool]:
        """Open the session dialog."""
        return self._client.post("/tui/open-sessions", query_params={"directory": directory})

    async def open_sessions_async(self, *, directory: str | None = None) -> Response[bool]:
        """Open the session dialog (async)."""
        return await self._client.apost(
            "/tui/open-sessions", query_params={"directory": directory}
        )

    def open_themes(self, *, directory: str | None = None) -> Response[bool]:
        """Open the theme dialog."""
        return self._client.post("/tui/open-themes", query_params={"directory": directory})

    async def open_themes_async(self, *, directory: str | None = None) -> Response[bool]:
        """Open the theme dialog (async)."""
        return await self._client.apost("/tui/open-themes", query_params={"directory": directory})

    def open_models(self, *, directory: str | None = None) -> Response[bool]:
        """Open the model dialog."""
        return self._client.post("/tui/open-models", query_params={"directory": directory})

    async def open_models_async(self, *, directory: str | None = None) -> Response[bool]:
        """Open the model dialog (async)."""
        return await self._client.apost("/tui/open-models", query_params={"directory": directory})

    def submit_prompt(self, *, directory: str | None = None) -> Response[bool]:
        """Submit the prompt."""
        return self._client.post("/tui/submit-prompt", query_params={"directory": directory})

    async def submit_prompt_async(self, *, directory: str | None = None) -> Response[bool]:
        """Submit the prompt (async)."""
        return await self._client.apost(
            "/tui/submit-prompt", query_params={"directory": directory}
        )

    def clear_prompt(self, *, directory: str | None = None) -> Response[bool]:
        """Clear the prompt."""
        return self._client.post("/tui/clear-prompt", query_params={"directory": directory})

    async def clear_prompt_async(self, *, directory: str | None = None) -> Response[bool]:
        """Clear the prompt (async)."""
        return await self._client.apost(
            "/tui/clear-prompt", query_params={"directory": directory}
        )

    def execute_command(
        self, *, command: str, directory: str | None = None
    ) -> Response[bool]:
        """Execute a TUI command (e.g. agent_cycle)."""
        body = {"command": command}
        return self._client.post(
            "/tui/execute-command", body=body, query_params={"directory": directory}
        )

    async def execute_command_async(
        self, *, command: str, directory: str | None = None
    ) -> Response[bool]:
        """Execute a TUI command (e.g. agent_cycle) (async)."""
        body = {"command": command}
        return await self._client.apost(
            "/tui/execute-command", body=body, query_params={"directory": directory}
        )

    def show_toast(
        self,
        *,
        message: str,
        variant: Literal["info", "success", "warning", "error"],
        title: str | None = None,
        duration: int | None = None,
        directory: str | None = None,
    ) -> Response[bool]:
        """Show a toast notification in the TUI."""
        body: dict[str, Any] = {"message": message, "variant": variant}
        if title is not None:
            body["title"] = title
        if duration is not None:
            body["duration"] = duration
        return self._client.post(
            "/tui/show-toast", body=body, query_params={"directory": directory}
        )

    async def show_toast_async(
        self,
        *,
        message: str,
        variant: Literal["info", "success", "warning", "error"],
        title: str | None = None,
        duration: int | None = None,
        directory: str | None = None,
    ) -> Response[bool]:
        """Show a toast notification in the TUI (async)."""
        body: dict[str, Any] = {"message": message, "variant": variant}
        if title is not None:
            body["title"] = title
        if duration is not None:
            body["duration"] = duration
        return await self._client.apost(
            "/tui/show-toast", body=body, query_params={"directory": directory}
        )

    def publish(self, event: Any, *, directory: str | None = None) -> Response[bool]:
        return self._client.post(
            "/tui/publish", body=event, query_params={"directory": directory}
        )

    async def publish_async(self, event: Any, *, directory: str | None = None) -> Response[bool]:
        return await self._client.apost(
            "/tui/publish", body=event, query_params={"directory": directory}
        )

    def select_session(
        self, *, session_id: str, directory: str | None = None
    ) -> Response[bool]:
        body = {"sessionID": session_id}
        return self._client.post(
            "/tui/select-session", body=body, query_params={"directory": directory}
        )

    async def select_session_async(
        self, *, session_id: str, directory: str | None = None
    ) -> Response[bool]:
        body = {"sessionID": session_id}
        return await self._client.apost(
            "/tui/select-session", body=body, query_params={"directory": directory}
        )


class AuthApi:
    """Auth API endpoints."""

    def __init__(self, client: HttpClient) -> None:
        self._client = client

    def set(
        self, provider_id: str, auth: Auth, *, directory: str | None = None
    ) -> Response[bool]:
        """Set authentication credentials."""
        return self._client.put(
            "/auth/{providerID}",
            path_params={"providerID": provider_id},
            body=auth,
            query_params={"directory": directory},
        )

    async def set_async(
        self, provider_id: str, auth: Auth, *, directory: str | None = None
    ) -> Response[bool]:
        """Set authentication credentials (async)."""
        return await self._client.aput(
            "/auth/{providerID}",
            path_params={"providerID": provider_id},
            body=auth,
            query_params={"directory": directory},
        )


class EventApi:
    """Event API endpoints."""

    def __init__(self, client: HttpClient) -> None:
        self._client = client

    def subscribe(self, *, directory: str | None = None) -> Iterator[SseEvent[Event]]:
        """Subscribe to events."""
        return self._client.sse("/event", query_params={"directory": directory})

    async def subscribe_async(
        self, *, directory: str | None = None
    ) -> AsyncIterator[SseEvent[Event]]:
        """Subscribe to events (async)."""
        async for event in self._client.asse("/event", query_params={"directory": directory}):
            yield event


class OpencodeClient:
    """Main OpenCode client with all API endpoints.

    Usage:
        from opencode_sdk import create_opencode_client

        client = create_opencode_client(base_url="http://127.0.0.1:4096")

        # Sync usage
        sessions = client.session.list()
        if sessions.ok:
            print(sessions.data)

        # Async usage
        sessions = await client.session.list_async()
    """

    def __init__(self, config: ClientConfig | None = None) -> None:
        self._http = HttpClient(config)

        self.global_ = GlobalApi(self._http)
        self.project = ProjectApi(self._http)
        self.pty = PtyApi(self._http)
        self.config = ConfigApi(self._http)
        self.tool = ToolApi(self._http)
        self.instance = InstanceApi(self._http)
        self.path = PathApi(self._http)
        self.worktree = WorktreeApi(self._http)
        self.vcs = VcsApi(self._http)
        self.session = SessionApi(self._http)
        self.part = PartApi(self._http)
        self.permission = PermissionApi(self._http)
        self.question = QuestionApi(self._http)
        self.command = CommandApi(self._http)
        self.provider = ProviderApi(self._http)
        self.find = FindApi(self._http)
        self.file = FileApi(self._http)
        self.app = AppApi(self._http)
        self.mcp = McpApi(self._http)
        self.experimental = ExperimentalApi(self._http)
        self.lsp = LspApi(self._http)
        self.formatter = FormatterApi(self._http)
        self.tui = TuiApi(self._http)
        self.auth = AuthApi(self._http)
        self.event = EventApi(self._http)

    def close(self) -> None:
        """Close the client and release resources."""
        self._http.close()

    async def aclose(self) -> None:
        """Close the client and release resources (async)."""
        await self._http.aclose()

    def __enter__(self) -> "OpencodeClient":
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()

    async def __aenter__(self) -> "OpencodeClient":
        return self

    async def __aexit__(self, *args: Any) -> None:
        await self.aclose()


def create_opencode_client(
    *,
    base_url: str = "http://127.0.0.1:4096",
    timeout: float | None = None,
    headers: dict[str, str] | None = None,
    directory: str | None = None,
) -> OpencodeClient:
    """Create an OpenCode client.

    Args:
        base_url: Base URL of the OpenCode server.
        timeout: Request timeout in seconds (None for no timeout).
        headers: Additional headers to include in all requests.
        directory: Default directory for the OpenCode instance.

    Returns:
        An OpencodeClient instance.
    """
    config = ClientConfig(
        base_url=base_url,
        timeout=timeout,
        headers=headers or {},
        directory=directory,
    )
    return OpencodeClient(config)
