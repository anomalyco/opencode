import pytest
import json
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).parent.parent.parent
sys.path.insert(0, str(ROOT_DIR))

from opencode_vk_gateway import SessionManager


class TestSessionManager:
    @pytest.fixture
    def sessions_file(self, tmp_path):
        sessions_data = {
            "12345": "session-abc-123",
            "67890": "session-def-456",
        }
        file_path = tmp_path / "sessions.json"
        file_path.write_text(json.dumps(sessions_data))
        return file_path, sessions_data

    def test_load_sessions_success(self, sessions_file):
        file_path, expected = sessions_file
        mgr = SessionManager(file_path)
        
        assert mgr.sessions == {12345: "session-abc-123", 67890: "session-def-456"}

    def test_load_sessions_file_not_found(self, tmp_path):
        file_path = tmp_path / "nonexistent.json"
        mgr = SessionManager(file_path)
        
        assert mgr.sessions == {}

    def test_load_sessions_invalid_json(self, tmp_path):
        file_path = tmp_path / "invalid.json"
        file_path.write_text("{ invalid }")
        mgr = SessionManager(file_path)
        
        assert mgr.sessions == {}

    def test_save_sessions(self, tmp_path):
        file_path = tmp_path / "sessions.json"
        mgr = SessionManager(file_path)
        mgr.sessions = {12345: "session-test", 67890: "session-test-2"}
        
        mgr._save()
        
        loaded = json.loads(file_path.read_text())
        assert loaded == {"12345": "session-test", "67890": "session-test-2"}

    @pytest.mark.asyncio
    async def test_get_or_create_existing_session(self, sessions_file):
        file_path, _ = sessions_file
        mgr = SessionManager(file_path)
        
        result = await mgr.get_or_create(12345)
        
        assert result == "session-abc-123"

    @pytest.mark.asyncio
    async def test_get_or_create_new_session(self, tmp_path):
        file_path = tmp_path / "sessions.json"
        mgr = SessionManager(file_path)
        
        assert mgr.sessions == {}

    def test_remove_existing_session(self, sessions_file):
        file_path, _ = sessions_file
        mgr = SessionManager(file_path)
        
        mgr.remove(12345)
        
        assert 12345 not in mgr.sessions

    def test_remove_nonexistent_session(self, sessions_file):
        file_path, _ = sessions_file
        mgr = SessionManager(file_path)
        
        mgr.remove(99999)
        original_count = len(mgr.sessions)
        
        mgr.remove(99999)
        assert len(mgr.sessions) == original_count