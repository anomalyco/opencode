"""Pytest fixtures for OpenCode SDK tests."""

from __future__ import annotations

import pytest
from unittest.mock import MagicMock, AsyncMock
import httpx

from opencode_sdk.client import ClientConfig, HttpClient, Response


@pytest.fixture
def client_config() -> ClientConfig:
    """Create a test client configuration."""
    return ClientConfig(
        base_url="http://test.local:4096",
        timeout=30.0,
        headers={"X-Test": "true"},
        directory="/test/project",
    )


@pytest.fixture
def http_client(client_config: ClientConfig) -> HttpClient:
    """Create a test HTTP client."""
    return HttpClient(client_config)


@pytest.fixture
def mock_response() -> httpx.Response:
    """Create a mock HTTP response."""
    response = MagicMock(spec=httpx.Response)
    response.is_success = True
    response.status_code = 200
    response.headers = {"Content-Type": "application/json"}
    response.json.return_value = {"id": "test_123", "name": "test"}
    response.request = MagicMock(spec=httpx.Request)
    return response


@pytest.fixture
def mock_error_response() -> httpx.Response:
    """Create a mock error HTTP response."""
    response = MagicMock(spec=httpx.Response)
    response.is_success = False
    response.status_code = 404
    response.headers = {"Content-Type": "application/json"}
    response.json.return_value = {"error": "Not found"}
    response.request = MagicMock(spec=httpx.Request)
    return response
