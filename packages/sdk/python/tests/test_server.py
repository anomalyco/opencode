"""Tests for the server module."""

from __future__ import annotations

import pytest
from unittest.mock import MagicMock, patch, AsyncMock
import subprocess

from opencode_sdk.server import (
    ServerOptions,
    TuiOptions,
    Server,
    AsyncServer,
    Tui,
    create_opencode_server,
    create_opencode_tui,
)


class TestServerOptions:
    """Tests for ServerOptions."""

    def test_defaults(self) -> None:
        """Test default server options."""
        opts = ServerOptions()
        assert opts.hostname == "127.0.0.1"
        assert opts.port == 4096
        assert opts.timeout == 5.0
        assert opts.config is None

    def test_custom_values(self) -> None:
        """Test custom server options."""
        opts = ServerOptions(
            hostname="0.0.0.0",
            port=8080,
            timeout=10.0,
            config={"logLevel": "DEBUG"},
        )
        assert opts.hostname == "0.0.0.0"
        assert opts.port == 8080
        assert opts.timeout == 10.0
        assert opts.config == {"logLevel": "DEBUG"}


class TestTuiOptions:
    """Tests for TuiOptions."""

    def test_defaults(self) -> None:
        """Test default TUI options."""
        opts = TuiOptions()
        assert opts.project is None
        assert opts.model is None
        assert opts.session is None
        assert opts.agent is None
        assert opts.config is None

    def test_custom_values(self) -> None:
        """Test custom TUI options."""
        opts = TuiOptions(
            project="/my/project",
            model="anthropic/claude-3",
            session="ses_123",
            agent="build",
            config={"logLevel": "INFO"},
        )
        assert opts.project == "/my/project"
        assert opts.model == "anthropic/claude-3"
        assert opts.session == "ses_123"
        assert opts.agent == "build"


class TestServer:
    """Tests for Server class."""

    def test_properties(self) -> None:
        """Test server properties."""
        mock_proc = MagicMock(spec=subprocess.Popen)
        mock_proc.pid = 12345
        
        server = Server(
            url="http://127.0.0.1:4096",
            _process=mock_proc,
        )
        
        assert server.url == "http://127.0.0.1:4096"

    def test_close(self) -> None:
        """Test closing server."""
        mock_proc = MagicMock(spec=subprocess.Popen)
        
        server = Server(
            url="http://127.0.0.1:4096",
            _process=mock_proc,
        )
        
        server.close()
        mock_proc.terminate.assert_called_once()
        mock_proc.wait.assert_called_once()

    def test_close_with_timeout(self) -> None:
        """Test closing server with timeout."""
        mock_proc = MagicMock(spec=subprocess.Popen)
        mock_proc.wait.side_effect = subprocess.TimeoutExpired("cmd", 5)
        
        server = Server(
            url="http://127.0.0.1:4096",
            _process=mock_proc,
        )
        
        server.close()
        mock_proc.terminate.assert_called_once()
        mock_proc.kill.assert_called_once()


class TestTui:
    """Tests for Tui class."""

    def test_close(self) -> None:
        """Test closing TUI."""
        mock_proc = MagicMock(spec=subprocess.Popen)
        
        tui = Tui(_process=mock_proc)
        
        tui.close()
        mock_proc.terminate.assert_called_once()


class TestCreateOpencodeServer:
    """Tests for create_opencode_server."""

    @patch("opencode_sdk.server.subprocess.Popen")
    @patch("opencode_sdk.server.select.select")
    def test_starts_server(
        self,
        mock_select: MagicMock,
        mock_popen: MagicMock,
    ) -> None:
        """Test that server is started correctly."""
        mock_proc = MagicMock()
        mock_proc.pid = 12345
        mock_proc.poll.return_value = None
        mock_proc.stdout = MagicMock()
        mock_proc.stdout.read.return_value = b"opencode server listening on http://127.0.0.1:4096\n"
        mock_popen.return_value = mock_proc
        
        mock_select.return_value = ([mock_proc.stdout], [], [])
        
        result = create_opencode_server()
        
        assert result.url == "http://127.0.0.1:4096"
        mock_popen.assert_called_once()

    @patch("opencode_sdk.server.subprocess.Popen")
    def test_raises_when_server_exits_early(self, mock_popen: MagicMock) -> None:
        """Test error when server exits during startup."""
        mock_proc = MagicMock()
        mock_proc.poll.return_value = 1  # Exited with code 1
        mock_proc.communicate.return_value = (b"Error", b"Startup failed")
        mock_proc.returncode = 1
        mock_popen.return_value = mock_proc
        
        with pytest.raises(RuntimeError, match="Server exited"):
            create_opencode_server()

    @patch("opencode_sdk.server.subprocess.Popen")
    @patch("opencode_sdk.server.select.select")
    @patch("opencode_sdk.server.time.time")
    def test_raises_on_timeout(
        self,
        mock_time: MagicMock,
        mock_select: MagicMock,
        mock_popen: MagicMock,
    ) -> None:
        """Test timeout when server doesn't start."""
        mock_proc = MagicMock()
        mock_proc.poll.return_value = None
        mock_proc.stdout = MagicMock()
        mock_popen.return_value = mock_proc
        
        mock_select.return_value = ([], [], [])
        mock_time.side_effect = [0, 1, 2, 3, 4, 5, 6]  # Simulate time passing
        
        with pytest.raises(TimeoutError, match="Timeout"):
            create_opencode_server()

    @patch("opencode_sdk.server.subprocess.Popen")
    @patch("opencode_sdk.server.select.select")
    def test_uses_custom_port(
        self,
        mock_select: MagicMock,
        mock_popen: MagicMock,
    ) -> None:
        """Test that custom port is used."""
        mock_proc = MagicMock()
        mock_proc.pid = 12345
        mock_proc.poll.return_value = None
        mock_proc.stdout = MagicMock()
        mock_proc.stdout.read.return_value = b"opencode server listening on http://127.0.0.1:8080\n"
        mock_popen.return_value = mock_proc
        
        mock_select.return_value = ([mock_proc.stdout], [], [])
        
        opts = ServerOptions(port=8080)
        result = create_opencode_server(opts)
        
        assert "8080" in result.url


class TestCreateOpencodeTui:
    """Tests for create_opencode_tui."""

    @patch("opencode_sdk.server.subprocess.Popen")
    def test_starts_tui(self, mock_popen: MagicMock) -> None:
        """Test that TUI is started correctly."""
        mock_proc = MagicMock()
        mock_proc.pid = 12345
        mock_popen.return_value = mock_proc
        
        result = create_opencode_tui()
        
        assert result is not None
        mock_popen.assert_called_once()

    @patch("opencode_sdk.server.subprocess.Popen")
    def test_passes_tui_options(self, mock_popen: MagicMock) -> None:
        """Test that TUI options are passed as arguments."""
        mock_proc = MagicMock()
        mock_popen.return_value = mock_proc
        
        opts = TuiOptions(
            project="/my/project",
            model="anthropic/claude-3",
            session="ses_123",
            agent="build",
        )
        
        create_opencode_tui(opts)
        
        call_args = mock_popen.call_args[0][0]
        assert "--project=/my/project" in call_args
        assert "--model=anthropic/claude-3" in call_args
        assert "--session=ses_123" in call_args
        assert "--agent=build" in call_args
