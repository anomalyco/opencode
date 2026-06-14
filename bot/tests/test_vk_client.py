import pytest
import json
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

ROOT_DIR = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT_DIR))

import opencode_vk_gateway as gateway


class TestVKClient:
    @pytest.fixture
    def vk_client(self):
        return gateway.VKClient("test_token")

    @pytest.mark.asyncio
    async def test_enter_exit(self, vk_client):
        async with vk_client as client:
            assert client.session is not None
        
        assert vk_client.session.closed

    @pytest.mark.asyncio
    async def test_api_request_success(self, vk_client):
        mock_response = {
            "response": {
                "server": "vk.com",
                "key": "test_key",
                "ts": "12345"
            }
        }
        
        vk_client.session = MagicMock()
        mock_get = AsyncMock()
        mock_resp = AsyncMock()
        mock_resp.json = AsyncMock(return_value=mock_response)
        mock_get.__aenter__ = AsyncMock(return_value=mock_resp)
        mock_get.__aexit__ = AsyncMock(return_value=None)
        vk_client.session.get = MagicMock(return_value=mock_get)
        
        result = await vk_client._api_request("messages.getLongPollServer", {})
        
        assert result == mock_response["response"]

    @pytest.mark.asyncio
    async def test_api_request_error(self, vk_client):
        error_response = {
            "error": {
                "error_code": 5,
                "error_msg": "User authorization failed"
            }
        }
        
        vk_client.session = MagicMock()
        mock_get = AsyncMock()
        mock_resp = AsyncMock()
        mock_resp.json = AsyncMock(return_value=error_response)
        mock_get.__aenter__ = AsyncMock(return_value=mock_resp)
        mock_get.__aexit__ = AsyncMock(return_value=None)
        vk_client.session.get = MagicMock(return_value=mock_get)
        
        with pytest.raises(Exception, match="VK API error"):
            await vk_client._api_request("messages.getLongPollServer", {})

    @pytest.mark.asyncio
    async def test_get_long_poll_server(self, vk_client):
        mock_response = {
            "server": "vk.com/im",
            "key": "test_key",
            "ts": "123456"
        }
        
        with patch.object(vk_client, "_api_request", new_callable=AsyncMock) as mock_api:
            mock_api.return_value = mock_response
            
            result = await vk_client.get_long_poll_server()
            
            assert result == ("vk.com/im", "test_key", 123456)

    @pytest.mark.asyncio
    async def test_get_messages_by_ids(self, vk_client):
        mock_response = {
            "items": [
                {"id": 1, "text": "Test message 1"},
                {"id": 2, "text": "Test message 2"},
            ]
        }
        
        with patch.object(vk_client, "_api_request", new_callable=AsyncMock) as mock_api:
            mock_api.return_value = mock_response
            
            result = await vk_client.get_messages_by_ids([1, 2])
            
            assert len(result) == 2
            assert result[0]["text"] == "Test message 1"

    @pytest.mark.asyncio
    async def test_send_message_text(self, vk_client):
        mock_response = [{"message_id": 12345}]
        
        with patch.object(vk_client, "_api_request", new_callable=AsyncMock) as mock_api:
            mock_api.return_value = mock_response
            
            result = await vk_client.send_message(peer_id=12345, text="Test message")
            
            assert result == 12345

    @pytest.mark.asyncio
    async def test_send_message_with_attachment(self, vk_client):
        mock_response = [{"message_id": 12345}]
        
        with patch.object(vk_client, "_api_request", new_callable=AsyncMock) as mock_api:
            mock_api.return_value = mock_response
            
            result = await vk_client.send_message(
                peer_id=12345,
                text="Test",
                attachment="doc123_456"
            )
            
            assert result == 12345

    @pytest.mark.asyncio
    async def test_send_message_with_keyboard(self, vk_client):
        mock_response = [{"message_id": 12345}]
        keyboard = {
            "inline": True,
            "buttons": [[{"action": {"type": "text", "label": "OK"}, "color": "primary"}]]
        }
        
        with patch.object(vk_client, "_api_request", new_callable=AsyncMock) as mock_api:
            mock_api.return_value = mock_response
            
            result = await vk_client.send_message(
                peer_id=12345,
                text="Test",
                keyboard=keyboard
            )
            
            assert result == 12345