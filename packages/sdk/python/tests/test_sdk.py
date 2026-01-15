"""Tests for the SDK API classes."""

from __future__ import annotations

import pytest
from unittest.mock import MagicMock, AsyncMock, patch
from typing import cast

from opencode_sdk.client import HttpClient, Response, ClientConfig
from opencode_sdk.sdk import (
    GlobalApi,
    ProjectApi,
    PtyApi,
    ConfigApi,
    ToolApi,
    InstanceApi,
    PathApi,
    VcsApi,
    SessionApi,
    PartApi,
    PermissionApi,
    QuestionApi,
    WorktreeApi,
    ResourceApi,
    ExperimentalApi,
    CommandApi,
    ProviderApi,
    OAuthApi,
    FindApi,
    FileApi,
    AppApi,
    McpApi,
    McpAuthApi,
    LspApi,
    FormatterApi,
    TuiApi,
    TuiControlApi,
    AuthApi,
    EventApi,
    OpencodeClient,
)
from opencode_sdk.types import TextPartInput, McpLocalConfig


@pytest.fixture
def mock_client() -> MagicMock:
    """Create a mock HTTP client."""
    client = MagicMock(spec=HttpClient)
    client.get.return_value = Response(data={"id": "test_123"})
    client.post.return_value = Response(data={"id": "test_123"})
    client.put.return_value = Response(data={"id": "test_123"})
    client.patch.return_value = Response(data={"id": "test_123"})
    client.delete.return_value = Response(data=True)
    
    client.aget = AsyncMock(return_value=Response(data={"id": "test_123"}))
    client.apost = AsyncMock(return_value=Response(data={"id": "test_123"}))
    client.aput = AsyncMock(return_value=Response(data={"id": "test_123"}))
    client.apatch = AsyncMock(return_value=Response(data={"id": "test_123"}))
    client.adelete = AsyncMock(return_value=Response(data=True))
    
    return client


class TestProjectApi:
    """Tests for ProjectApi."""

    def test_list(self, mock_client: MagicMock) -> None:
        """Test listing projects."""
        api = ProjectApi(mock_client)
        result = api.list()
        mock_client.get.assert_called_once_with("/project", query_params={"directory": None})
        assert result.ok

    def test_list_with_directory(self, mock_client: MagicMock) -> None:
        """Test listing projects with directory filter."""
        api = ProjectApi(mock_client)
        result = api.list(directory="/my/project")
        mock_client.get.assert_called_once_with("/project", query_params={"directory": "/my/project"})
        assert result.ok

    def test_current(self, mock_client: MagicMock) -> None:
        """Test getting current project."""
        api = ProjectApi(mock_client)
        result = api.current()
        mock_client.get.assert_called_once_with("/project/current", query_params={"directory": None})
        assert result.ok

    @pytest.mark.asyncio
    async def test_list_async(self, mock_client: MagicMock) -> None:
        """Test async listing projects."""
        api = ProjectApi(mock_client)
        result = await api.list_async()
        mock_client.aget.assert_called_once()
        assert result.ok

    @pytest.mark.asyncio
    async def test_current_async(self, mock_client: MagicMock) -> None:
        """Test async getting current project."""
        api = ProjectApi(mock_client)
        result = await api.current_async()
        mock_client.aget.assert_called_once()
        assert result.ok


class TestPtyApi:
    """Tests for PtyApi."""

    def test_list(self, mock_client: MagicMock) -> None:
        """Test listing PTY sessions."""
        api = PtyApi(mock_client)
        result = api.list()
        mock_client.get.assert_called_once()
        assert result.ok

    def test_create(self, mock_client: MagicMock) -> None:
        """Test creating PTY session."""
        api = PtyApi(mock_client)
        result = api.create(command="bash", args=["-l"], cwd="/home", title="Test")
        mock_client.post.assert_called_once()
        call_args = mock_client.post.call_args
        assert call_args[0][0] == "/pty"
        assert call_args[1]["body"]["command"] == "bash"
        assert call_args[1]["body"]["args"] == ["-l"]
        assert result.ok

    def test_create_minimal(self, mock_client: MagicMock) -> None:
        """Test creating PTY session with minimal params."""
        api = PtyApi(mock_client)
        result = api.create()
        mock_client.post.assert_called_once()
        call_args = mock_client.post.call_args
        assert call_args[1]["body"] is None
        assert result.ok

    def test_get(self, mock_client: MagicMock) -> None:
        """Test getting PTY session."""
        api = PtyApi(mock_client)
        result = api.get("pty_123")
        mock_client.get.assert_called_once_with(
            "/pty/{ptyID}",
            path_params={"ptyID": "pty_123"},
            query_params={"directory": None},
        )
        assert result.ok

    def test_remove(self, mock_client: MagicMock) -> None:
        """Test removing PTY session."""
        api = PtyApi(mock_client)
        result = api.remove("pty_123")
        mock_client.delete.assert_called_once()
        assert result.ok

    def test_update(self, mock_client: MagicMock) -> None:
        """Test updating PTY session."""
        api = PtyApi(mock_client)
        result = api.update("pty_123", title="New Title", size={"cols": 80, "rows": 24})
        mock_client.put.assert_called_once()
        assert result.ok

    def test_connect(self, mock_client: MagicMock) -> None:
        """Test connecting to PTY session."""
        api = PtyApi(mock_client)
        result = api.connect("pty_123")
        mock_client.get.assert_called_once()
        assert result.ok


class TestConfigApi:
    """Tests for ConfigApi."""

    def test_get(self, mock_client: MagicMock) -> None:
        """Test getting config."""
        api = ConfigApi(mock_client)
        result = api.get()
        mock_client.get.assert_called_once_with("/config", query_params={"directory": None})
        assert result.ok

    def test_update(self, mock_client: MagicMock) -> None:
        """Test updating config."""
        api = ConfigApi(mock_client)
        result = api.update({"theme": "dark"})  # type: ignore
        mock_client.patch.assert_called_once()
        assert result.ok

    def test_providers(self, mock_client: MagicMock) -> None:
        """Test listing providers."""
        api = ConfigApi(mock_client)
        result = api.providers()
        mock_client.get.assert_called_once_with("/config/providers", query_params={"directory": None})
        assert result.ok


class TestSessionApi:
    """Tests for SessionApi."""

    def test_list(self, mock_client: MagicMock) -> None:
        """Test listing sessions."""
        api = SessionApi(mock_client)
        result = api.list()
        mock_client.get.assert_called_once()
        assert result.ok

    def test_create(self, mock_client: MagicMock) -> None:
        """Test creating session."""
        api = SessionApi(mock_client)
        result = api.create(title="Test Session")
        mock_client.post.assert_called_once()
        call_args = mock_client.post.call_args
        assert call_args[1]["body"]["title"] == "Test Session"
        assert result.ok

    def test_create_with_parent(self, mock_client: MagicMock) -> None:
        """Test creating session with parent."""
        api = SessionApi(mock_client)
        result = api.create(parent_id="ses_parent", title="Child Session")
        call_args = mock_client.post.call_args
        assert call_args[1]["body"]["parentID"] == "ses_parent"
        assert result.ok

    def test_get(self, mock_client: MagicMock) -> None:
        """Test getting session."""
        api = SessionApi(mock_client)
        result = api.get("ses_123")
        mock_client.get.assert_called_once_with(
            "/session/{sessionID}",
            path_params={"sessionID": "ses_123"},
            query_params={"directory": None},
        )
        assert result.ok

    def test_update(self, mock_client: MagicMock) -> None:
        """Test updating session."""
        api = SessionApi(mock_client)
        result = api.update("ses_123", title="Updated Title")
        mock_client.patch.assert_called_once()
        assert result.ok

    def test_delete(self, mock_client: MagicMock) -> None:
        """Test deleting session."""
        api = SessionApi(mock_client)
        result = api.delete("ses_123")
        mock_client.delete.assert_called_once()
        assert result.ok

    def test_status(self, mock_client: MagicMock) -> None:
        """Test getting session status."""
        api = SessionApi(mock_client)
        result = api.status()
        mock_client.get.assert_called_once()
        assert result.ok

    def test_children(self, mock_client: MagicMock) -> None:
        """Test getting session children."""
        api = SessionApi(mock_client)
        result = api.children("ses_123")
        mock_client.get.assert_called_once()
        assert result.ok

    def test_todo(self, mock_client: MagicMock) -> None:
        """Test getting session todo list."""
        api = SessionApi(mock_client)
        result = api.todo("ses_123")
        mock_client.get.assert_called_once()
        assert result.ok

    def test_fork(self, mock_client: MagicMock) -> None:
        """Test forking session."""
        api = SessionApi(mock_client)
        result = api.fork("ses_123", message_id="msg_456")
        mock_client.post.assert_called_once()
        call_args = mock_client.post.call_args
        assert call_args[1]["body"]["messageID"] == "msg_456"
        assert result.ok

    def test_abort(self, mock_client: MagicMock) -> None:
        """Test aborting session."""
        api = SessionApi(mock_client)
        result = api.abort("ses_123")
        mock_client.post.assert_called_once()
        assert result.ok

    def test_share(self, mock_client: MagicMock) -> None:
        """Test sharing session."""
        api = SessionApi(mock_client)
        result = api.share("ses_123")
        mock_client.post.assert_called_once()
        assert result.ok

    def test_unshare(self, mock_client: MagicMock) -> None:
        """Test unsharing session."""
        api = SessionApi(mock_client)
        result = api.unshare("ses_123")
        mock_client.delete.assert_called_once()
        assert result.ok

    def test_diff(self, mock_client: MagicMock) -> None:
        """Test getting session diff."""
        api = SessionApi(mock_client)
        result = api.diff("ses_123", message_id="msg_456")
        mock_client.get.assert_called_once()
        assert result.ok

    def test_messages(self, mock_client: MagicMock) -> None:
        """Test listing messages."""
        api = SessionApi(mock_client)
        result = api.messages("ses_123", limit=50)
        mock_client.get.assert_called_once()
        call_args = mock_client.get.call_args
        assert call_args[1]["query_params"]["limit"] == 50
        assert result.ok

    def test_message(self, mock_client: MagicMock) -> None:
        """Test getting a single message."""
        api = SessionApi(mock_client)
        result = api.message("ses_123", "msg_456")
        mock_client.get.assert_called_once()
        call_args = mock_client.get.call_args
        assert call_args[1]["path_params"]["sessionID"] == "ses_123"
        assert call_args[1]["path_params"]["messageID"] == "msg_456"
        assert result.ok

    def test_prompt(self, mock_client: MagicMock) -> None:
        """Test sending a prompt."""
        api = SessionApi(mock_client)
        parts: list[TextPartInput] = [{"type": "text", "text": "Hello!"}]
        result = api.prompt("ses_123", parts=parts)
        mock_client.post.assert_called_once()
        call_args = mock_client.post.call_args
        assert call_args[1]["body"]["parts"] == parts
        assert result.ok

    def test_prompt_with_options(self, mock_client: MagicMock) -> None:
        """Test sending a prompt with all options."""
        api = SessionApi(mock_client)
        parts: list[TextPartInput] = [{"type": "text", "text": "Hello!"}]
        model = {"providerID": "anthropic", "modelID": "claude-3"}
        result = api.prompt(
            "ses_123",
            parts=parts,
            model=model,
            agent="build",
            no_reply=False,
            system="Be helpful",
            tools={"write": True, "read": True},
        )
        call_args = mock_client.post.call_args
        body = call_args[1]["body"]
        assert body["parts"] == parts
        assert body["model"] == model
        assert body["agent"] == "build"
        assert body["noReply"] is False
        assert body["system"] == "Be helpful"
        assert body["tools"] == {"write": True, "read": True}
        assert result.ok

    def test_prompt_async_fire(self, mock_client: MagicMock) -> None:
        """Test fire-and-forget prompt."""
        api = SessionApi(mock_client)
        parts: list[TextPartInput] = [{"type": "text", "text": "Hello!"}]
        result = api.prompt_async_fire("ses_123", parts=parts)
        mock_client.post.assert_called_once()
        call_args = mock_client.post.call_args
        assert "/prompt_async" in call_args[0][0]
        assert result.ok

    def test_command(self, mock_client: MagicMock) -> None:
        """Test sending a command."""
        api = SessionApi(mock_client)
        result = api.command("ses_123", command="git", arguments="status")
        mock_client.post.assert_called_once()
        call_args = mock_client.post.call_args
        assert call_args[1]["body"]["command"] == "git"
        assert call_args[1]["body"]["arguments"] == "status"
        assert result.ok

    def test_shell(self, mock_client: MagicMock) -> None:
        """Test running a shell command."""
        api = SessionApi(mock_client)
        result = api.shell("ses_123", agent="build", command="ls -la")
        mock_client.post.assert_called_once()
        call_args = mock_client.post.call_args
        assert call_args[1]["body"]["command"] == "ls -la"
        assert result.ok

    def test_revert(self, mock_client: MagicMock) -> None:
        """Test reverting a message."""
        api = SessionApi(mock_client)
        result = api.revert("ses_123", message_id="msg_456")
        mock_client.post.assert_called_once()
        assert result.ok

    def test_unrevert(self, mock_client: MagicMock) -> None:
        """Test unreverting messages."""
        api = SessionApi(mock_client)
        result = api.unrevert("ses_123")
        mock_client.post.assert_called_once()
        assert result.ok

    def test_permission_respond(self, mock_client: MagicMock) -> None:
        """Test responding to permission request."""
        api = SessionApi(mock_client)
        result = api.permission_respond("ses_123", "perm_456", response="always")
        mock_client.post.assert_called_once()
        call_args = mock_client.post.call_args
        assert call_args[1]["body"]["response"] == "always"
        assert result.ok

    def test_init(self, mock_client: MagicMock) -> None:
        """Test session init."""
        api = SessionApi(mock_client)
        result = api.init(
            "ses_123",
            model_id="claude-3",
            provider_id="anthropic",
            message_id="msg_456",
        )
        mock_client.post.assert_called_once()
        assert result.ok

    def test_summarize(self, mock_client: MagicMock) -> None:
        """Test summarizing session."""
        api = SessionApi(mock_client)
        result = api.summarize("ses_123", provider_id="anthropic", model_id="claude-3")
        mock_client.post.assert_called_once()
        assert result.ok

    def test_summarize_with_auto(self, mock_client: MagicMock) -> None:
        """Test summarizing session with auto parameter."""
        api = SessionApi(mock_client)
        result = api.summarize("ses_123", provider_id="anthropic", model_id="claude-3", auto=True)
        mock_client.post.assert_called_once()
        call_args = mock_client.post.call_args
        assert call_args[1]["body"]["auto"] is True
        assert result.ok

    def test_prompt_with_variant(self, mock_client: MagicMock) -> None:
        """Test sending a prompt with variant parameter."""
        api = SessionApi(mock_client)
        parts: list[TextPartInput] = [{"type": "text", "text": "Hello!"}]
        result = api.prompt("ses_123", parts=parts, variant="fast")
        mock_client.post.assert_called_once()
        call_args = mock_client.post.call_args
        assert call_args[1]["body"]["variant"] == "fast"
        assert result.ok

    def test_prompt_async_fire_with_variant(self, mock_client: MagicMock) -> None:
        """Test fire-and-forget prompt with variant parameter."""
        api = SessionApi(mock_client)
        parts: list[TextPartInput] = [{"type": "text", "text": "Hello!"}]
        result = api.prompt_async_fire("ses_123", parts=parts, variant="fast")
        mock_client.post.assert_called_once()
        call_args = mock_client.post.call_args
        assert call_args[1]["body"]["variant"] == "fast"
        assert result.ok

    def test_command_with_variant_and_parts(self, mock_client: MagicMock) -> None:
        """Test sending a command with variant and parts parameters."""
        api = SessionApi(mock_client)
        parts = [{"type": "text", "text": "additional context"}]
        result = api.command(
            "ses_123",
            command="git",
            arguments="status",
            variant="fast",
            parts=parts,
        )
        mock_client.post.assert_called_once()
        call_args = mock_client.post.call_args
        assert call_args[1]["body"]["command"] == "git"
        assert call_args[1]["body"]["arguments"] == "status"
        assert call_args[1]["body"]["variant"] == "fast"
        assert call_args[1]["body"]["parts"] == parts
        assert result.ok

    @pytest.mark.asyncio
    async def test_summarize_with_auto_async(self, mock_client: MagicMock) -> None:
        """Test async summarizing session with auto parameter."""
        api = SessionApi(mock_client)
        result = await api.summarize_async(
            "ses_123", provider_id="anthropic", model_id="claude-3", auto=True
        )
        mock_client.apost.assert_called_once()
        call_args = mock_client.apost.call_args
        assert call_args[1]["body"]["auto"] is True
        assert result.ok

    @pytest.mark.asyncio
    async def test_prompt_with_variant_async(self, mock_client: MagicMock) -> None:
        """Test async sending a prompt with variant parameter."""
        api = SessionApi(mock_client)
        parts: list[TextPartInput] = [{"type": "text", "text": "Hello!"}]
        result = await api.prompt_async("ses_123", parts=parts, variant="fast")
        mock_client.apost.assert_called_once()
        call_args = mock_client.apost.call_args
        assert call_args[1]["body"]["variant"] == "fast"
        assert result.ok

    @pytest.mark.asyncio
    async def test_prompt_async_fire_with_variant_async(self, mock_client: MagicMock) -> None:
        """Test async fire-and-forget prompt with variant parameter."""
        api = SessionApi(mock_client)
        parts: list[TextPartInput] = [{"type": "text", "text": "Hello!"}]
        result = await api.prompt_async_fire_async("ses_123", parts=parts, variant="fast")
        mock_client.apost.assert_called_once()
        call_args = mock_client.apost.call_args
        assert call_args[1]["body"]["variant"] == "fast"
        assert result.ok

    @pytest.mark.asyncio
    async def test_command_with_variant_and_parts_async(self, mock_client: MagicMock) -> None:
        """Test async sending a command with variant and parts parameters."""
        api = SessionApi(mock_client)
        parts = [{"type": "text", "text": "additional context"}]
        result = await api.command_async(
            "ses_123",
            command="git",
            arguments="status",
            variant="fast",
            parts=parts,
        )
        mock_client.apost.assert_called_once()
        call_args = mock_client.apost.call_args
        assert call_args[1]["body"]["command"] == "git"
        assert call_args[1]["body"]["arguments"] == "status"
        assert call_args[1]["body"]["variant"] == "fast"
        assert call_args[1]["body"]["parts"] == parts
        assert result.ok


class TestToolApi:
    """Tests for ToolApi."""

    def test_ids(self, mock_client: MagicMock) -> None:
        """Test getting tool IDs."""
        api = ToolApi(mock_client)
        result = api.ids()
        mock_client.get.assert_called_once()
        assert result.ok

    def test_list(self, mock_client: MagicMock) -> None:
        """Test listing tools."""
        api = ToolApi(mock_client)
        result = api.list(provider="anthropic", model="claude-3")
        mock_client.get.assert_called_once()
        call_args = mock_client.get.call_args
        assert call_args[1]["query_params"]["provider"] == "anthropic"
        assert call_args[1]["query_params"]["model"] == "claude-3"
        assert result.ok


class TestFindApi:
    """Tests for FindApi."""

    def test_text(self, mock_client: MagicMock) -> None:
        """Test finding text."""
        api = FindApi(mock_client)
        result = api.text(pattern="TODO")
        mock_client.get.assert_called_once()
        call_args = mock_client.get.call_args
        assert call_args[1]["query_params"]["pattern"] == "TODO"
        assert result.ok

    def test_files(self, mock_client: MagicMock) -> None:
        """Test finding files."""
        api = FindApi(mock_client)
        result = api.files(query="*.py")
        mock_client.get.assert_called_once()
        assert result.ok

    def test_files_with_dirs(self, mock_client: MagicMock) -> None:
        """Test finding files including directories."""
        api = FindApi(mock_client)
        result = api.files(query="src", dirs=True)
        mock_client.get.assert_called_once()
        call_args = mock_client.get.call_args
        assert call_args[1]["query_params"]["dirs"] == "true"
        assert result.ok

    def test_files_with_type(self, mock_client: MagicMock) -> None:
        """Test finding files with type filter."""
        api = FindApi(mock_client)
        result = api.files(query="*.py", type="file")
        mock_client.get.assert_called_once()
        call_args = mock_client.get.call_args
        assert call_args[1]["query_params"]["type"] == "file"
        assert result.ok

    def test_files_with_limit(self, mock_client: MagicMock) -> None:
        """Test finding files with limit."""
        api = FindApi(mock_client)
        result = api.files(query="*.py", limit=100)
        mock_client.get.assert_called_once()
        call_args = mock_client.get.call_args
        assert call_args[1]["query_params"]["limit"] == 100
        assert result.ok

    def test_files_with_type_and_limit(self, mock_client: MagicMock) -> None:
        """Test finding files with type and limit parameters."""
        api = FindApi(mock_client)
        result = api.files(query="src", type="directory", limit=50)
        mock_client.get.assert_called_once()
        call_args = mock_client.get.call_args
        assert call_args[1]["query_params"]["type"] == "directory"
        assert call_args[1]["query_params"]["limit"] == 50
        assert result.ok

    @pytest.mark.asyncio
    async def test_files_with_type_async(self, mock_client: MagicMock) -> None:
        """Test async finding files with type filter."""
        api = FindApi(mock_client)
        result = await api.files_async(query="*.py", type="file")
        mock_client.aget.assert_called_once()
        call_args = mock_client.aget.call_args
        assert call_args[1]["query_params"]["type"] == "file"
        assert result.ok

    @pytest.mark.asyncio
    async def test_files_with_limit_async(self, mock_client: MagicMock) -> None:
        """Test async finding files with limit."""
        api = FindApi(mock_client)
        result = await api.files_async(query="*.py", limit=100)
        mock_client.aget.assert_called_once()
        call_args = mock_client.aget.call_args
        assert call_args[1]["query_params"]["limit"] == 100
        assert result.ok

    @pytest.mark.asyncio
    async def test_files_with_type_and_limit_async(self, mock_client: MagicMock) -> None:
        """Test async finding files with type and limit parameters."""
        api = FindApi(mock_client)
        result = await api.files_async(query="src", type="directory", limit=50)
        mock_client.aget.assert_called_once()
        call_args = mock_client.aget.call_args
        assert call_args[1]["query_params"]["type"] == "directory"
        assert call_args[1]["query_params"]["limit"] == 50
        assert result.ok

    def test_symbols(self, mock_client: MagicMock) -> None:
        """Test finding symbols."""
        api = FindApi(mock_client)
        result = api.symbols(query="MyClass")
        mock_client.get.assert_called_once()
        assert result.ok


class TestFileApi:
    """Tests for FileApi."""

    def test_list(self, mock_client: MagicMock) -> None:
        """Test listing files."""
        api = FileApi(mock_client)
        result = api.list(path="/src")
        mock_client.get.assert_called_once()
        call_args = mock_client.get.call_args
        assert call_args[1]["query_params"]["path"] == "/src"
        assert result.ok

    def test_read(self, mock_client: MagicMock) -> None:
        """Test reading a file."""
        api = FileApi(mock_client)
        result = api.read(path="/src/main.py")
        mock_client.get.assert_called_once()
        assert result.ok

    def test_status(self, mock_client: MagicMock) -> None:
        """Test getting file status."""
        api = FileApi(mock_client)
        result = api.status()
        mock_client.get.assert_called_once()
        assert result.ok


class TestMcpApi:
    """Tests for McpApi."""

    def test_status(self, mock_client: MagicMock) -> None:
        """Test getting MCP status."""
        api = McpApi(mock_client)
        result = api.status()
        mock_client.get.assert_called_once()
        assert result.ok

    def test_add(self, mock_client: MagicMock) -> None:
        """Test adding MCP server."""
        api = McpApi(mock_client)
        config: McpLocalConfig = {"type": "local", "command": "npx", "args": ["-y", "mcp-server"]}
        result = api.add(name="test-mcp", config=config)
        mock_client.post.assert_called_once()
        call_args = mock_client.post.call_args
        assert call_args[1]["body"]["name"] == "test-mcp"
        assert result.ok

    def test_connect(self, mock_client: MagicMock) -> None:
        """Test connecting MCP server."""
        api = McpApi(mock_client)
        result = api.connect("test-mcp")
        mock_client.post.assert_called_once()
        assert result.ok

    def test_disconnect(self, mock_client: MagicMock) -> None:
        """Test disconnecting MCP server."""
        api = McpApi(mock_client)
        result = api.disconnect("test-mcp")
        mock_client.post.assert_called_once()
        assert result.ok


class TestMcpAuthApi:
    """Tests for McpAuthApi."""

    def test_start(self, mock_client: MagicMock) -> None:
        """Test starting OAuth flow."""
        api = McpAuthApi(mock_client)
        result = api.start("test-mcp")
        mock_client.post.assert_called_once()
        assert result.ok

    def test_remove(self, mock_client: MagicMock) -> None:
        """Test removing OAuth credentials."""
        api = McpAuthApi(mock_client)
        result = api.remove("test-mcp")
        mock_client.delete.assert_called_once()
        assert result.ok

    def test_callback(self, mock_client: MagicMock) -> None:
        """Test OAuth callback."""
        api = McpAuthApi(mock_client)
        result = api.callback("test-mcp", code="auth_code_123")
        mock_client.post.assert_called_once()
        call_args = mock_client.post.call_args
        assert call_args[1]["body"]["code"] == "auth_code_123"
        assert result.ok

    def test_authenticate(self, mock_client: MagicMock) -> None:
        """Test full OAuth authentication."""
        api = McpAuthApi(mock_client)
        result = api.authenticate("test-mcp")
        mock_client.post.assert_called_once()
        assert result.ok


class TestProviderApi:
    """Tests for ProviderApi."""

    def test_list(self, mock_client: MagicMock) -> None:
        """Test listing providers."""
        api = ProviderApi(mock_client)
        result = api.list()
        mock_client.get.assert_called_once()
        assert result.ok

    def test_auth(self, mock_client: MagicMock) -> None:
        """Test getting provider auth methods."""
        api = ProviderApi(mock_client)
        result = api.auth()
        mock_client.get.assert_called_once()
        assert result.ok

    def test_oauth_sub_api(self, mock_client: MagicMock) -> None:
        """Test that OAuth sub-api is accessible."""
        api = ProviderApi(mock_client)
        assert hasattr(api, "oauth")
        assert isinstance(api.oauth, OAuthApi)


class TestOAuthApi:
    """Tests for OAuthApi."""

    def test_authorize(self, mock_client: MagicMock) -> None:
        """Test OAuth authorization."""
        api = OAuthApi(mock_client)
        result = api.authorize("anthropic", method=1)
        mock_client.post.assert_called_once()
        assert result.ok

    def test_callback(self, mock_client: MagicMock) -> None:
        """Test OAuth callback."""
        api = OAuthApi(mock_client)
        result = api.callback("anthropic", method=1, code="auth_code")
        mock_client.post.assert_called_once()
        assert result.ok


class TestAppApi:
    """Tests for AppApi."""

    def test_log(self, mock_client: MagicMock) -> None:
        """Test logging."""
        api = AppApi(mock_client)
        result = api.log(service="test", level="info", message="Test message")
        mock_client.post.assert_called_once()
        call_args = mock_client.post.call_args
        assert call_args[1]["body"]["service"] == "test"
        assert call_args[1]["body"]["level"] == "info"
        assert result.ok

    def test_log_with_extra(self, mock_client: MagicMock) -> None:
        """Test logging with extra data."""
        api = AppApi(mock_client)
        result = api.log(
            service="test",
            level="debug",
            message="Debug",
            extra={"key": "value"},
        )
        call_args = mock_client.post.call_args
        assert call_args[1]["body"]["extra"] == {"key": "value"}
        assert result.ok

    def test_agents(self, mock_client: MagicMock) -> None:
        """Test listing agents."""
        api = AppApi(mock_client)
        result = api.agents()
        mock_client.get.assert_called_once()
        assert result.ok


class TestGlobalApi:

    def test_health(self, mock_client: MagicMock) -> None:
        api = GlobalApi(mock_client)
        result = api.health()
        mock_client.get.assert_called_once_with("/global/health")
        assert result.ok

    def test_dispose(self, mock_client: MagicMock) -> None:
        api = GlobalApi(mock_client)
        result = api.dispose()
        mock_client.post.assert_called_once_with("/global/dispose")
        assert result.ok

    @pytest.mark.asyncio
    async def test_health_async(self, mock_client: MagicMock) -> None:
        api = GlobalApi(mock_client)
        result = await api.health_async()
        mock_client.aget.assert_called_once()
        assert result.ok

    @pytest.mark.asyncio
    async def test_dispose_async(self, mock_client: MagicMock) -> None:
        api = GlobalApi(mock_client)
        result = await api.dispose_async()
        mock_client.apost.assert_called_once()
        assert result.ok


class TestPartApi:

    def test_delete(self, mock_client: MagicMock) -> None:
        api = PartApi(mock_client)
        result = api.delete("ses_123", "msg_456", "part_789")
        mock_client.delete.assert_called_once()
        call_args = mock_client.delete.call_args
        assert call_args[1]["path_params"]["sessionID"] == "ses_123"
        assert call_args[1]["path_params"]["messageID"] == "msg_456"
        assert call_args[1]["path_params"]["partID"] == "part_789"
        assert result.ok

    def test_update(self, mock_client: MagicMock) -> None:
        api = PartApi(mock_client)
        part = {"type": "text", "text": "updated"}
        result = api.update("ses_123", "msg_456", "part_789", part)  # type: ignore
        mock_client.patch.assert_called_once()
        call_args = mock_client.patch.call_args
        assert call_args[1]["path_params"]["sessionID"] == "ses_123"
        assert call_args[1]["path_params"]["messageID"] == "msg_456"
        assert call_args[1]["path_params"]["partID"] == "part_789"
        assert result.ok

    @pytest.mark.asyncio
    async def test_delete_async(self, mock_client: MagicMock) -> None:
        api = PartApi(mock_client)
        result = await api.delete_async("ses_123", "msg_456", "part_789")
        mock_client.adelete.assert_called_once()
        assert result.ok

    @pytest.mark.asyncio
    async def test_update_async(self, mock_client: MagicMock) -> None:
        api = PartApi(mock_client)
        part = {"type": "text", "text": "updated"}
        result = await api.update_async("ses_123", "msg_456", "part_789", part)  # type: ignore
        mock_client.apatch.assert_called_once()
        assert result.ok


class TestPermissionApi:

    def test_list(self, mock_client: MagicMock) -> None:
        api = PermissionApi(mock_client)
        result = api.list()
        mock_client.get.assert_called_once_with("/permission", query_params={"directory": None})
        assert result.ok

    def test_reply(self, mock_client: MagicMock) -> None:
        api = PermissionApi(mock_client)
        result = api.reply("req_123", reply="always")
        mock_client.post.assert_called_once()
        call_args = mock_client.post.call_args
        assert call_args[1]["path_params"]["requestID"] == "req_123"
        assert call_args[1]["body"]["reply"] == "always"
        assert result.ok

    def test_reply_with_message(self, mock_client: MagicMock) -> None:
        api = PermissionApi(mock_client)
        result = api.reply("req_123", reply="reject", message="Not allowed")
        call_args = mock_client.post.call_args
        assert call_args[1]["body"]["message"] == "Not allowed"
        assert result.ok

    def test_respond(self, mock_client: MagicMock) -> None:
        api = PermissionApi(mock_client)
        result = api.respond("ses_123", "perm_456", response="once")
        mock_client.post.assert_called_once()
        call_args = mock_client.post.call_args
        assert call_args[1]["path_params"]["sessionID"] == "ses_123"
        assert call_args[1]["path_params"]["permissionID"] == "perm_456"
        assert call_args[1]["body"]["response"] == "once"
        assert result.ok

    @pytest.mark.asyncio
    async def test_list_async(self, mock_client: MagicMock) -> None:
        api = PermissionApi(mock_client)
        result = await api.list_async()
        mock_client.aget.assert_called_once()
        assert result.ok

    @pytest.mark.asyncio
    async def test_reply_async(self, mock_client: MagicMock) -> None:
        api = PermissionApi(mock_client)
        result = await api.reply_async("req_123", reply="always")
        mock_client.apost.assert_called_once()
        assert result.ok

    @pytest.mark.asyncio
    async def test_respond_async(self, mock_client: MagicMock) -> None:
        api = PermissionApi(mock_client)
        result = await api.respond_async("ses_123", "perm_456", response="once")
        mock_client.apost.assert_called_once()
        assert result.ok


class TestQuestionApi:

    def test_list(self, mock_client: MagicMock) -> None:
        api = QuestionApi(mock_client)
        result = api.list()
        mock_client.get.assert_called_once_with("/question", query_params={"directory": None})
        assert result.ok

    def test_reply(self, mock_client: MagicMock) -> None:
        api = QuestionApi(mock_client)
        answers = [["answer1", "answer2"]]
        result = api.reply("req_123", answers=answers)
        mock_client.post.assert_called_once()
        call_args = mock_client.post.call_args
        assert call_args[1]["path_params"]["requestID"] == "req_123"
        assert call_args[1]["body"]["answers"] == answers
        assert result.ok

    def test_reject(self, mock_client: MagicMock) -> None:
        api = QuestionApi(mock_client)
        result = api.reject("req_123")
        mock_client.post.assert_called_once()
        call_args = mock_client.post.call_args
        assert call_args[1]["path_params"]["requestID"] == "req_123"
        assert result.ok

    @pytest.mark.asyncio
    async def test_list_async(self, mock_client: MagicMock) -> None:
        api = QuestionApi(mock_client)
        result = await api.list_async()
        mock_client.aget.assert_called_once()
        assert result.ok

    @pytest.mark.asyncio
    async def test_reply_async(self, mock_client: MagicMock) -> None:
        api = QuestionApi(mock_client)
        answers = [["answer1"]]
        result = await api.reply_async("req_123", answers=answers)
        mock_client.apost.assert_called_once()
        assert result.ok

    @pytest.mark.asyncio
    async def test_reject_async(self, mock_client: MagicMock) -> None:
        api = QuestionApi(mock_client)
        result = await api.reject_async("req_123")
        mock_client.apost.assert_called_once()
        assert result.ok


class TestWorktreeApi:

    def test_list(self, mock_client: MagicMock) -> None:
        api = WorktreeApi(mock_client)
        result = api.list()
        mock_client.get.assert_called_once_with(
            "/experimental/worktree", query_params={"directory": None}
        )
        assert result.ok

    def test_create(self, mock_client: MagicMock) -> None:
        api = WorktreeApi(mock_client)
        result = api.create(name="feature-branch", start_command="npm run dev")
        mock_client.post.assert_called_once()
        call_args = mock_client.post.call_args
        assert call_args[1]["body"]["name"] == "feature-branch"
        assert call_args[1]["body"]["startCommand"] == "npm run dev"
        assert result.ok

    def test_create_minimal(self, mock_client: MagicMock) -> None:
        api = WorktreeApi(mock_client)
        result = api.create()
        mock_client.post.assert_called_once()
        call_args = mock_client.post.call_args
        assert call_args[1]["body"] is None
        assert result.ok

    @pytest.mark.asyncio
    async def test_list_async(self, mock_client: MagicMock) -> None:
        api = WorktreeApi(mock_client)
        result = await api.list_async()
        mock_client.aget.assert_called_once()
        assert result.ok

    @pytest.mark.asyncio
    async def test_create_async(self, mock_client: MagicMock) -> None:
        api = WorktreeApi(mock_client)
        result = await api.create_async(name="feature-branch")
        mock_client.apost.assert_called_once()
        assert result.ok


class TestResourceApi:

    def test_list(self, mock_client: MagicMock) -> None:
        api = ResourceApi(mock_client)
        result = api.list()
        mock_client.get.assert_called_once_with(
            "/experimental/resource", query_params={"directory": None}
        )
        assert result.ok

    @pytest.mark.asyncio
    async def test_list_async(self, mock_client: MagicMock) -> None:
        api = ResourceApi(mock_client)
        result = await api.list_async()
        mock_client.aget.assert_called_once()
        assert result.ok


class TestExperimentalApi:

    def test_has_resource_subapi(self, mock_client: MagicMock) -> None:
        api = ExperimentalApi(mock_client)
        assert hasattr(api, "resource")
        assert isinstance(api.resource, ResourceApi)


class TestInstanceApi:

    def test_dispose(self, mock_client: MagicMock) -> None:
        api = InstanceApi(mock_client)
        result = api.dispose()
        mock_client.post.assert_called_once_with(
            "/instance/dispose", query_params={"directory": None}
        )
        assert result.ok

    @pytest.mark.asyncio
    async def test_dispose_async(self, mock_client: MagicMock) -> None:
        api = InstanceApi(mock_client)
        result = await api.dispose_async()
        mock_client.apost.assert_called_once()
        assert result.ok


class TestPathApi:

    def test_get(self, mock_client: MagicMock) -> None:
        api = PathApi(mock_client)
        result = api.get()
        mock_client.get.assert_called_once_with("/path", query_params={"directory": None})
        assert result.ok

    @pytest.mark.asyncio
    async def test_get_async(self, mock_client: MagicMock) -> None:
        api = PathApi(mock_client)
        result = await api.get_async()
        mock_client.aget.assert_called_once()
        assert result.ok


class TestVcsApi:

    def test_get(self, mock_client: MagicMock) -> None:
        api = VcsApi(mock_client)
        result = api.get()
        mock_client.get.assert_called_once_with("/vcs", query_params={"directory": None})
        assert result.ok

    @pytest.mark.asyncio
    async def test_get_async(self, mock_client: MagicMock) -> None:
        api = VcsApi(mock_client)
        result = await api.get_async()
        mock_client.aget.assert_called_once()
        assert result.ok


class TestCommandApi:

    def test_list(self, mock_client: MagicMock) -> None:
        api = CommandApi(mock_client)
        result = api.list()
        mock_client.get.assert_called_once_with("/command", query_params={"directory": None})
        assert result.ok

    @pytest.mark.asyncio
    async def test_list_async(self, mock_client: MagicMock) -> None:
        api = CommandApi(mock_client)
        result = await api.list_async()
        mock_client.aget.assert_called_once()
        assert result.ok


class TestLspApi:

    def test_status(self, mock_client: MagicMock) -> None:
        api = LspApi(mock_client)
        result = api.status()
        mock_client.get.assert_called_once_with("/lsp", query_params={"directory": None})
        assert result.ok

    @pytest.mark.asyncio
    async def test_status_async(self, mock_client: MagicMock) -> None:
        api = LspApi(mock_client)
        result = await api.status_async()
        mock_client.aget.assert_called_once()
        assert result.ok


class TestFormatterApi:

    def test_status(self, mock_client: MagicMock) -> None:
        api = FormatterApi(mock_client)
        result = api.status()
        mock_client.get.assert_called_once_with("/formatter", query_params={"directory": None})
        assert result.ok

    @pytest.mark.asyncio
    async def test_status_async(self, mock_client: MagicMock) -> None:
        api = FormatterApi(mock_client)
        result = await api.status_async()
        mock_client.aget.assert_called_once()
        assert result.ok


class TestTuiControlApi:

    def test_next(self, mock_client: MagicMock) -> None:
        api = TuiControlApi(mock_client)
        result = api.next()
        mock_client.get.assert_called_once_with(
            "/tui/control/next", query_params={"directory": None}
        )
        assert result.ok

    def test_response(self, mock_client: MagicMock) -> None:
        api = TuiControlApi(mock_client)
        result = api.response({"key": "value"})
        mock_client.post.assert_called_once()
        call_args = mock_client.post.call_args
        assert call_args[1]["body"] == {"key": "value"}
        assert result.ok

    @pytest.mark.asyncio
    async def test_next_async(self, mock_client: MagicMock) -> None:
        api = TuiControlApi(mock_client)
        result = await api.next_async()
        mock_client.aget.assert_called_once()
        assert result.ok

    @pytest.mark.asyncio
    async def test_response_async(self, mock_client: MagicMock) -> None:
        api = TuiControlApi(mock_client)
        result = await api.response_async({"key": "value"})
        mock_client.apost.assert_called_once()
        assert result.ok


class TestTuiApiComplete:

    def test_append_prompt(self, mock_client: MagicMock) -> None:
        api = TuiApi(mock_client)
        result = api.append_prompt(text="Hello")
        mock_client.post.assert_called_once()
        call_args = mock_client.post.call_args
        assert call_args[1]["body"]["text"] == "Hello"
        assert result.ok

    def test_open_help(self, mock_client: MagicMock) -> None:
        api = TuiApi(mock_client)
        result = api.open_help()
        mock_client.post.assert_called_once_with(
            "/tui/open-help", query_params={"directory": None}
        )
        assert result.ok

    def test_open_sessions(self, mock_client: MagicMock) -> None:
        api = TuiApi(mock_client)
        result = api.open_sessions()
        mock_client.post.assert_called_once_with(
            "/tui/open-sessions", query_params={"directory": None}
        )
        assert result.ok

    def test_open_themes(self, mock_client: MagicMock) -> None:
        api = TuiApi(mock_client)
        result = api.open_themes()
        mock_client.post.assert_called_once_with(
            "/tui/open-themes", query_params={"directory": None}
        )
        assert result.ok

    def test_open_models(self, mock_client: MagicMock) -> None:
        api = TuiApi(mock_client)
        result = api.open_models()
        mock_client.post.assert_called_once_with(
            "/tui/open-models", query_params={"directory": None}
        )
        assert result.ok

    def test_submit_prompt(self, mock_client: MagicMock) -> None:
        api = TuiApi(mock_client)
        result = api.submit_prompt()
        mock_client.post.assert_called_once_with(
            "/tui/submit-prompt", query_params={"directory": None}
        )
        assert result.ok

    def test_clear_prompt(self, mock_client: MagicMock) -> None:
        api = TuiApi(mock_client)
        result = api.clear_prompt()
        mock_client.post.assert_called_once_with(
            "/tui/clear-prompt", query_params={"directory": None}
        )
        assert result.ok

    def test_execute_command(self, mock_client: MagicMock) -> None:
        api = TuiApi(mock_client)
        result = api.execute_command(command="agent_cycle")
        mock_client.post.assert_called_once()
        call_args = mock_client.post.call_args
        assert call_args[1]["body"]["command"] == "agent_cycle"
        assert result.ok

    def test_show_toast(self, mock_client: MagicMock) -> None:
        api = TuiApi(mock_client)
        result = api.show_toast(message="Hello", variant="info", title="Title", duration=3000)
        mock_client.post.assert_called_once()
        call_args = mock_client.post.call_args
        assert call_args[1]["body"]["message"] == "Hello"
        assert call_args[1]["body"]["variant"] == "info"
        assert call_args[1]["body"]["title"] == "Title"
        assert call_args[1]["body"]["duration"] == 3000
        assert result.ok

    def test_publish(self, mock_client: MagicMock) -> None:
        api = TuiApi(mock_client)
        event = {"type": "tui.prompt.append", "properties": {"text": "Hello"}}
        result = api.publish(event)
        mock_client.post.assert_called_once()
        call_args = mock_client.post.call_args
        assert call_args[1]["body"] == event
        assert result.ok

    def test_select_session(self, mock_client: MagicMock) -> None:
        api = TuiApi(mock_client)
        result = api.select_session(session_id="ses_123")
        mock_client.post.assert_called_once()
        call_args = mock_client.post.call_args
        assert call_args[1]["body"]["sessionID"] == "ses_123"
        assert result.ok

    def test_has_control_subapi(self, mock_client: MagicMock) -> None:
        api = TuiApi(mock_client)
        assert hasattr(api, "control")
        assert isinstance(api.control, TuiControlApi)


class TestAuthApi:

    def test_set(self, mock_client: MagicMock) -> None:
        api = AuthApi(mock_client)
        auth = {"type": "api", "key": "sk-xxx"}
        result = api.set("anthropic", auth)  # type: ignore
        mock_client.put.assert_called_once()
        call_args = mock_client.put.call_args
        assert call_args[1]["path_params"]["providerID"] == "anthropic"
        assert call_args[1]["body"] == auth
        assert result.ok

    @pytest.mark.asyncio
    async def test_set_async(self, mock_client: MagicMock) -> None:
        api = AuthApi(mock_client)
        auth = {"type": "api", "key": "sk-xxx"}
        result = await api.set_async("anthropic", auth)  # type: ignore
        mock_client.aput.assert_called_once()
        assert result.ok


class TestOpencodeClient:
    """Tests for OpencodeClient."""

    def test_initialization(self) -> None:
        """Test client initialization."""
        config = ClientConfig(base_url="http://test:4096")
        client = OpencodeClient(config)
        
        assert client.project is not None
        assert client.session is not None
        assert client.config is not None
        assert client.pty is not None
        assert client.tool is not None
        assert client.instance is not None
        assert client.path is not None
        assert client.vcs is not None
        assert client.command is not None
        assert client.provider is not None
        assert client.find is not None
        assert client.file is not None
        assert client.app is not None
        assert client.mcp is not None
        assert client.lsp is not None
        assert client.formatter is not None
        assert client.tui is not None
        assert client.auth is not None
        assert client.event is not None
        assert client.global_ is not None
        assert client.part is not None
        assert client.permission is not None
        assert client.question is not None
        assert client.worktree is not None
        assert client.experimental is not None

    def test_close(self) -> None:
        """Test client close."""
        config = ClientConfig()
        client = OpencodeClient(config)
        mock_http = MagicMock()
        client._http = mock_http
        client.close()
        mock_http.close.assert_called_once()

    @pytest.mark.asyncio
    async def test_aclose(self) -> None:
        """Test async client close."""
        config = ClientConfig()
        client = OpencodeClient(config)
        mock_http = MagicMock()
        mock_http.aclose = AsyncMock()
        client._http = mock_http
        await client.aclose()
        mock_http.aclose.assert_called_once()

    def test_context_manager(self) -> None:
        """Test client as context manager."""
        config = ClientConfig()
        with OpencodeClient(config) as client:
            assert client is not None

    @pytest.mark.asyncio
    async def test_async_context_manager(self) -> None:
        """Test client as async context manager."""
        config = ClientConfig()
        async with OpencodeClient(config) as client:
            assert client is not None
