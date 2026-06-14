import pytest
import json
import os
import signal
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

ROOT_DIR = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT_DIR))

from gateway_restarter import (
    load_vk_token, get_gateway_pid, save_gateway_pid,
    remove_pid_file, is_process_running, restart_gateway
)


class TestLoadVkToken:
    def test_load_vk_token_success(self, tmp_path):
        config_data = {"vk_token": "test_vk_token"}
        config_file = tmp_path / "config.json"
        config_file.write_text(json.dumps(config_data))
        
        import gateway_restarter
        original_dir = gateway_restarter.SCRIPT_DIR
        gateway_restarter.SCRIPT_DIR = tmp_path
        
        try:
            token = load_vk_token()
            assert token == "test_vk_token"
        finally:
            gateway_restarter.SCRIPT_DIR = original_dir

    def test_load_vk_token_missing_file(self, tmp_path):
        config_file = tmp_path / "config.json"
        
        import gateway_restarter
        original_dir = gateway_restarter.SCRIPT_DIR
        gateway_restarter.SCRIPT_DIR = tmp_path
        
        try:
            with pytest.raises(FileNotFoundError):
                load_vk_token()
        finally:
            gateway_restarter.SCRIPT_DIR = original_dir

    def test_load_vk_token_empty_token(self, tmp_path):
        config_data = {"vk_token": ""}
        config_file = tmp_path / "config.json"
        config_file.write_text(json.dumps(config_data))
        
        import gateway_restarter
        original_dir = gateway_restarter.SCRIPT_DIR
        gateway_restarter.SCRIPT_DIR = tmp_path
        
        try:
            with pytest.raises(ValueError, match="vk_token is empty"):
                load_vk_token()
        finally:
            gateway_restarter.SCRIPT_DIR = original_dir


class TestGetGatewayPid:
    def test_get_gateway_pid_success(self, tmp_path):
        pid_file = tmp_path / ".gateway.pid"
        pid_file.write_text("12345")
        
        import gateway_restarter
        original_pid_file = gateway_restarter.PID_FILE
        gateway_restarter.PID_FILE = pid_file
        
        try:
            pid = get_gateway_pid()
            assert pid == 12345
        finally:
            gateway_restarter.PID_FILE = original_pid_file

    def test_get_gateway_pid_file_not_exists(self, tmp_path):
        pid_file = tmp_path / ".gateway.pid"
        
        import gateway_restarter
        original_pid_file = gateway_restarter.PID_FILE
        gateway_restarter.PID_FILE = pid_file
        
        try:
            pid = get_gateway_pid()
            assert pid is None
        finally:
            gateway_restarter.PID_FILE = original_pid_file


class TestIsProcessRunning:
    def test_process_running(self):
        with patch("os.kill") as mock_kill:
            mock_kill.return_value = None
            
            result = is_process_running(os.getpid())
            
            assert result is True

    def test_process_not_running(self):
        with patch("os.kill") as mock_kill:
            mock_kill.side_effect = OSError("No such process")
            
            result = is_process_running(99999)
            
            assert result is False