"""Tests for the types module."""

from __future__ import annotations

import pytest

from opencode_sdk.types import (
    Session,
    Part,
    TextPart,
    FilePart,
    ToolPart,
    Event,
    Project,
    Config,
    Agent,
    Todo,
    Pty,
    FileNode,
    FileContent,
    FileStatus,
    FileDiff,
    FindMatch,
    Symbol,
    McpLocalConfig,
    McpStatus,
    LspStatus,
    FormatterStatus,
    VcsInfo,
    PathInfo,
    PartInput,
    TextPartInput,
    FilePartInput,
)


class TestSessionType:
    """Tests for Session type."""

    def test_session_structure(self) -> None:
        """Test that Session has expected keys."""
        # Just test that the type exists and can be imported
        assert Session is not None


class TestPartTypes:
    """Tests for Part types."""

    def test_text_part(self) -> None:
        """Test TextPart structure."""
        part: TextPart = {
            "type": "text",
            "text": "Hello, world!",
        }
        assert part["type"] == "text"
        assert part["text"] == "Hello, world!"

    def test_file_part(self) -> None:
        """Test FilePart structure."""
        part: FilePart = {
            "type": "file",
            "mime": "text/plain",
            "url": "file:///path/to/file.txt",
        }
        assert part["type"] == "file"
        assert part["mime"] == "text/plain"

    def test_tool_part(self) -> None:
        """Test ToolPart structure."""
        part: ToolPart = {
            "type": "tool",
            "id": "call_123",
            "tool": "read_file",
        }
        assert part["type"] == "tool"
        assert part["tool"] == "read_file"


class TestProjectType:
    """Tests for Project type."""

    def test_project_exists(self) -> None:
        """Test that Project type exists."""
        assert Project is not None


class TestAgentType:
    """Tests for Agent type."""

    def test_agent_exists(self) -> None:
        """Test that Agent type exists."""
        assert Agent is not None


class TestTodoType:
    """Tests for Todo type."""

    def test_todo_exists(self) -> None:
        """Test that Todo type exists."""
        assert Todo is not None


class TestPtyType:
    """Tests for Pty type."""

    def test_pty_exists(self) -> None:
        """Test that Pty type exists."""
        assert Pty is not None


class TestFileTypes:
    """Tests for File-related types."""

    def test_file_node_exists(self) -> None:
        """Test FileNode type exists."""
        assert FileNode is not None

    def test_file_content_exists(self) -> None:
        """Test FileContent type exists."""
        assert FileContent is not None

    def test_file_status_exists(self) -> None:
        """Test FileStatus type exists."""
        assert FileStatus is not None


class TestMcpTypes:
    """Tests for MCP-related types."""

    def test_mcp_local_config(self) -> None:
        """Test McpLocalConfig structure."""
        config: McpLocalConfig = {
            "type": "local",
            "command": "npx",
            "args": ["-y", "mcp-server"],
        }
        assert config["type"] == "local"
        assert config["command"] == "npx"


class TestPartInputTypes:
    """Tests for PartInput types."""

    def test_text_part_input(self) -> None:
        """Test TextPartInput structure."""
        part: TextPartInput = {
            "type": "text",
            "text": "Hello!",
        }
        assert part["type"] == "text"
        assert part["text"] == "Hello!"

    def test_file_part_input(self) -> None:
        """Test FilePartInput structure."""
        part: FilePartInput = {
            "type": "file",
            "mime": "text/plain",
            "url": "file:///test.txt",
        }
        assert part["type"] == "file"
        assert part["url"] == "file:///test.txt"


class TestTypeExports:
    """Tests to verify all expected types are exported."""

    def test_main_types_exported(self) -> None:
        """Test that main types are exported."""
        from opencode_sdk.types import (
            Session,
            Event,
            Config,
            Project,
        )
        assert Session is not None
        assert Event is not None
        assert Config is not None
        assert Project is not None

    def test_part_types_exported(self) -> None:
        """Test that Part types are exported."""
        from opencode_sdk.types import (
            Part,
            TextPart,
            FilePart,
            ToolPart,
        )
        assert Part is not None
        assert TextPart is not None
        assert FilePart is not None
        assert ToolPart is not None
