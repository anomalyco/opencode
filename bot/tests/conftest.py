"""
Конфигурация тестов и фикстуры
"""
import pytest
import asyncio
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch
import tempfile
import json
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from session_manager import SessionManager


@pytest.fixture
def temp_config_file():
    """Создаёт временный файл для сессий"""
    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
        f.write('{"sessions": {}, "seen_messages": {}, "grant_mode": {}}')
        f.flush()
        yield Path(f.name)
    # Очистка
    try:
        Path(f.name).unlink()
    except FileNotFoundError:
        pass


@pytest.fixture
def session_manager(temp_config_file):
    """Создаёт SessionManager с временным файлом"""
    return SessionManager(temp_config_file)


@pytest.fixture
def mock_vk_client():
    """Создаёт мок VK клиента"""
    vk = MagicMock()
    vk.send_message = AsyncMock(return_value=123)
    vk.edit_message = AsyncMock(return_value=True)
    return vk


@pytest.fixture
def mock_opencode_client():
    """Создаёт мок OpenCode клиента"""
    client = MagicMock()
    client.send_permission_response = AsyncMock(return_value=True)
    return client


@pytest.fixture
def mock_opencode_process():
    """Создаёт мок OpenCode процесса"""
    process = MagicMock()
    process.workdir = Path("/tmp/test")
    return process


@pytest.fixture
def event_loop():
    """Создаёт event loop для asyncio тестов"""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture
def sample_permission():
    """Создаёт пример разрешения для тестов"""
    return {
        "id": "perm-123",
        "session_id": "session-456",
        "permission": "write_file",
        "metadata": {"filepath": "/tmp/test.txt"}
    }


@pytest.fixture
def sample_crush_permission():
    """Создаёт пример разрешения в новом формате (Crush API)"""
    return {
        "id": "perm-789",
        "session_id": "session-456",
        "tool_name": "write",
        "action": "write_file",
        "path": "/tmp/test.txt"
    }
