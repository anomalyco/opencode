"""Tests for the HTTP client module."""

from __future__ import annotations

import pytest
from unittest.mock import MagicMock, patch, AsyncMock
import httpx

from opencode_sdk.client import ClientConfig, HttpClient, Response, SseEvent


class TestClientConfig:
    """Tests for ClientConfig."""

    def test_default_values(self) -> None:
        """Test default configuration values."""
        config = ClientConfig()
        assert config.base_url == "http://127.0.0.1:4096"
        assert config.timeout is None
        assert config.headers == {}
        assert config.directory is None

    def test_custom_values(self) -> None:
        """Test custom configuration values."""
        config = ClientConfig(
            base_url="http://custom:8080",
            timeout=60.0,
            headers={"Authorization": "Bearer token"},
            directory="/my/project",
        )
        assert config.base_url == "http://custom:8080"
        assert config.timeout == 60.0
        assert "Authorization" in config.headers
        assert config.directory == "/my/project"

    def test_directory_header_added(self) -> None:
        """Test that directory is added as a header."""
        config = ClientConfig(directory="/my/project")
        assert "x-opencode-directory" in config.headers
        assert config.headers["x-opencode-directory"] == "/my/project"

    def test_non_ascii_directory_encoded(self) -> None:
        """Test that non-ASCII directory paths are URL encoded."""
        config = ClientConfig(directory="/path/with/unicode/folder")
        assert "x-opencode-directory" in config.headers


class TestResponse:
    """Tests for Response class."""

    def test_ok_with_data(self) -> None:
        """Test ok property with valid data."""
        response = Response(data={"key": "value"})
        assert response.ok is True
        assert response.data == {"key": "value"}
        assert response.error is None

    def test_not_ok_with_error(self) -> None:
        """Test ok property with error."""
        response = Response(error="Something went wrong")
        assert response.ok is False
        assert response.data is None
        assert response.error == "Something went wrong"

    def test_not_ok_with_none_data(self) -> None:
        """Test ok property when data is None."""
        response = Response[dict]()
        assert response.ok is False


class TestSseEvent:
    """Tests for SseEvent class."""

    def test_basic_event(self) -> None:
        """Test basic SSE event creation."""
        event = SseEvent(data={"message": "hello"})
        assert event.data == {"message": "hello"}
        assert event.event is None
        assert event.id is None
        assert event.retry is None

    def test_full_event(self) -> None:
        """Test SSE event with all fields."""
        event = SseEvent(
            data={"message": "hello"},
            event="update",
            id="evt_123",
            retry=5000,
        )
        assert event.data == {"message": "hello"}
        assert event.event == "update"
        assert event.id == "evt_123"
        assert event.retry == 5000


class TestHttpClient:
    """Tests for HttpClient."""

    def test_default_config(self) -> None:
        """Test client with default config."""
        client = HttpClient()
        assert client.config.base_url == "http://127.0.0.1:4096"

    def test_custom_config(self, client_config: ClientConfig) -> None:
        """Test client with custom config."""
        client = HttpClient(client_config)
        assert client.config.base_url == "http://test.local:4096"
        assert client.config.timeout == 30.0

    def test_build_url_simple(self) -> None:
        """Test URL building with simple path."""
        client = HttpClient()
        url = client._build_url("/session")
        assert url == "/session"

    def test_build_url_with_path_params(self) -> None:
        """Test URL building with path parameters."""
        client = HttpClient()
        url = client._build_url(
            "/session/{id}/message/{messageID}",
            path_params={"id": "ses_123", "messageID": "msg_456"},
        )
        assert url == "/session/ses_123/message/msg_456"

    def test_build_url_with_query_params(self) -> None:
        """Test URL building with query parameters."""
        client = HttpClient()
        url = client._build_url(
            "/session",
            query_params={"limit": 10, "offset": 0},
        )
        assert url == "/session?limit=10&offset=0"

    def test_build_url_filters_none_query_params(self) -> None:
        """Test that None query parameters are filtered out."""
        client = HttpClient()
        url = client._build_url(
            "/session",
            query_params={"limit": 10, "offset": None, "filter": None},
        )
        assert url == "/session?limit=10"

    def test_build_url_combined(self) -> None:
        """Test URL building with both path and query params."""
        client = HttpClient()
        url = client._build_url(
            "/session/{id}",
            path_params={"id": "ses_123"},
            query_params={"directory": "/project"},
        )
        assert url == "/session/ses_123?directory=%2Fproject"

    @patch("httpx.Client")
    def test_get_client_creates_client(self, mock_client_class: MagicMock) -> None:
        """Test that _get_client creates an httpx client."""
        client = HttpClient()
        client._get_client()
        mock_client_class.assert_called_once()

    @patch("httpx.Client")
    def test_get_client_reuses_client(self, mock_client_class: MagicMock) -> None:
        """Test that _get_client reuses existing client."""
        client = HttpClient()
        client._get_client()
        client._get_client()
        assert mock_client_class.call_count == 1

    def test_close(self) -> None:
        """Test client close."""
        client = HttpClient()
        mock_httpx = MagicMock()
        client._client = mock_httpx
        client.close()
        mock_httpx.close.assert_called_once()
        assert client._client is None

    @pytest.mark.asyncio
    async def test_aclose(self) -> None:
        """Test async client close."""
        client = HttpClient()
        mock_httpx = AsyncMock()
        client._async_client = mock_httpx
        await client.aclose()
        mock_httpx.aclose.assert_called_once()
        assert client._async_client is None


class TestHttpClientRequests:
    """Tests for HTTP client request methods."""

    @patch.object(HttpClient, "request")
    def test_get(self, mock_request: MagicMock) -> None:
        """Test GET request."""
        client = HttpClient()
        mock_request.return_value = Response(data={"id": "123"})
        result = client.get("/test", query_params={"key": "value"})
        mock_request.assert_called_once_with(
            "GET", "/test", path_params=None, query_params={"key": "value"}, headers=None
        )
        assert result.ok

    @patch.object(HttpClient, "request")
    def test_post(self, mock_request: MagicMock) -> None:
        """Test POST request."""
        client = HttpClient()
        mock_request.return_value = Response(data={"id": "123"})
        result = client.post("/test", body={"name": "test"})
        mock_request.assert_called_once()
        assert result.ok

    @patch.object(HttpClient, "request")
    def test_put(self, mock_request: MagicMock) -> None:
        """Test PUT request."""
        client = HttpClient()
        mock_request.return_value = Response(data={"id": "123"})
        result = client.put("/test/{id}", path_params={"id": "123"}, body={"name": "updated"})
        mock_request.assert_called_once()
        assert result.ok

    @patch.object(HttpClient, "request")
    def test_patch(self, mock_request: MagicMock) -> None:
        """Test PATCH request."""
        client = HttpClient()
        mock_request.return_value = Response(data={"id": "123"})
        result = client.patch("/test/{id}", path_params={"id": "123"}, body={"name": "patched"})
        mock_request.assert_called_once()
        assert result.ok

    @patch.object(HttpClient, "request")
    def test_delete(self, mock_request: MagicMock) -> None:
        """Test DELETE request."""
        client = HttpClient()
        mock_request.return_value = Response(data=True)
        result = client.delete("/test/{id}", path_params={"id": "123"})
        mock_request.assert_called_once()
        assert result.ok


class TestHttpClientAsyncRequests:
    """Tests for HTTP client async request methods."""

    @pytest.mark.asyncio
    @patch.object(HttpClient, "arequest")
    async def test_aget(self, mock_arequest: MagicMock) -> None:
        """Test async GET request."""
        client = HttpClient()
        mock_arequest.return_value = Response(data={"id": "123"})
        result = await client.aget("/test")
        mock_arequest.assert_called_once()
        assert result.ok

    @pytest.mark.asyncio
    @patch.object(HttpClient, "arequest")
    async def test_apost(self, mock_arequest: MagicMock) -> None:
        """Test async POST request."""
        client = HttpClient()
        mock_arequest.return_value = Response(data={"id": "123"})
        result = await client.apost("/test", body={"name": "test"})
        mock_arequest.assert_called_once()
        assert result.ok

    @pytest.mark.asyncio
    @patch.object(HttpClient, "arequest")
    async def test_aput(self, mock_arequest: MagicMock) -> None:
        """Test async PUT request."""
        client = HttpClient()
        mock_arequest.return_value = Response(data={"id": "123"})
        result = await client.aput("/test/{id}", path_params={"id": "123"}, body={"name": "updated"})
        mock_arequest.assert_called_once()
        assert result.ok

    @pytest.mark.asyncio
    @patch.object(HttpClient, "arequest")
    async def test_apatch(self, mock_arequest: MagicMock) -> None:
        """Test async PATCH request."""
        client = HttpClient()
        mock_arequest.return_value = Response(data={"id": "123"})
        result = await client.apatch("/test/{id}", path_params={"id": "123"}, body={"name": "patched"})
        mock_arequest.assert_called_once()
        assert result.ok

    @pytest.mark.asyncio
    @patch.object(HttpClient, "arequest")
    async def test_adelete(self, mock_arequest: MagicMock) -> None:
        """Test async DELETE request."""
        client = HttpClient()
        mock_arequest.return_value = Response(data=True)
        result = await client.adelete("/test/{id}", path_params={"id": "123"})
        mock_arequest.assert_called_once()
        assert result.ok
