import pytest
import json
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT_DIR))

from opencode_vk_gateway import load_config


class TestLoadConfig:
    @pytest.fixture
    def temp_config(self, tmp_path):
        config_data = {
            "vk_token": "test_token",
            "opencode_url": "http://localhost:4096",
            "session_file": "test_sessions.json",
            "vk_api_version": "5.200",
            "longpoll_wait": 25,
            "thinking_peer_id": 123456,
            "model": "test/model",
            "llama_server_path": "/path/to/llama-server",
            "models": {
                "test-model": {
                    "model": "test/model",
                    "args": "-m /path/to/model.gguf --port 8081"
                }
            },
            "default_model": "test-model",
        }
        config_file = tmp_path / "config.json"
        config_file.write_text(json.dumps(config_data))
        return config_file, config_data

    def test_load_config_success(self, temp_config):
        config_file, expected = temp_config
        config = load_config(str(config_file))
        
        assert config["vk_token"] == "test_token"
        assert config["opencode_url"] == "http://localhost:4096"
        assert config["session_file"] == "test_sessions.json"
        assert config["vk_api_version"] == "5.200"
        assert config["longpoll_wait"] == 25
        assert config["thinking_peer_id"] == 123456
        assert config["model"] == "test/model"
        assert config["llama_server_path"] == "/path/to/llama-server"
        assert config["models"] == expected["models"]
        assert config["default_model"] == "test-model"

    def test_load_config_merge_with_defaults(self, temp_config):
        config_file, _ = temp_config
        config = load_config(str(config_file))
        
        assert "vk_token" in config
        assert "opencode_url" in config

    def test_load_config_file_not_found(self, tmp_path):
        config_file = tmp_path / "nonexistent.json"
        config = load_config(str(config_file))
        
        assert config["vk_token"] == "token"
        assert config["opencode_url"] == "http://127.0.0.1:4096"
        assert config["session_file"] == "sessions.json"

    def test_load_config_invalid_json(self, tmp_path):
        config_file = tmp_path / "invalid.json"
        config_file.write_text("{ invalid json }")
        
        with pytest.raises(json.JSONDecodeError):
            load_config(str(config_file))