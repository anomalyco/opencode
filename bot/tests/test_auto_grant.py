"""
Тесты для авто-одобрения разрешений в VKLongPoll
"""
import pytest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch, call


class TestAutoGrantPermissionResponse:
    """Тесты: авто-одобрение разрешений"""

    @pytest.mark.asyncio
    async def test_auto_grant_uses_always_not_once(self, mock_vk_client, mock_opencode_client,
                                                    mock_opencode_process, temp_config_file):
        """
        BUG: При авто-одобрении используется "once" вместо "always".
        "once" означает разовое одобрение, но пользователь всё равно видит запрос.
        "always" означает постоянное одобрение.
        """
        from vk_longpoll import VKLongPoll
        from session_manager import SessionManager
        
        # Создаём SessionManager и VKLongPoll
        session_mgr = SessionManager(temp_config_file)
        longpoll = VKLongPoll(mock_vk_client, session_mgr, mock_opencode_process)
        longpoll.opencode_client = mock_opencode_client
        session_id = "test-session-auto-grant"
        longpoll.user_session[999] = session_id
        longpoll.seen_permissions[session_id] = set()
        # Включаем авто-одобрение через session_mgr
        longpoll.session_mgr.set_grant_mode(session_id, True)
        
        # Создаём разрешение
        permission = {
            "id": "perm-auto-123",
            "session_id": session_id,
            "permission": "write_file",
            "metadata": {"filepath": "/tmp/test.txt"}
        }
        
        # Вызываем обработку разрешения
        await longpoll._process_permission(permission, session_id, 999)
        
        # Проверяем, что ответ был отправлен
        mock_opencode_client.send_permission_response.assert_called_once()
        
        # BUG: Проверка, что используется "always" не "once"
        call_args = mock_opencode_client.send_permission_response.call_args
        response_type = call_args[0][2]  # Третий аргумент: response
        
        assert response_type == "always", \
            f"Авто-одобрение должно использовать 'always', а не '{response_type}'"

    @pytest.mark.asyncio
    async def test_auto_grant_does_not_send_prompt(self, mock_vk_client, mock_opencode_client,
                                                    mock_opencode_process, temp_config_file):
        """При авто-одобрении не должно отправляться сообщение пользователю с клавиатурой"""
        from vk_longpoll import VKLongPoll
        from session_manager import SessionManager
        
        session_mgr = SessionManager(temp_config_file)
        longpoll = VKLongPoll(mock_vk_client, session_mgr, mock_opencode_process)
        longpoll.opencode_client = mock_opencode_client
        session_id = "test-session-no-prompt"
        longpoll.user_session[999] = session_id
        longpoll.seen_permissions[session_id] = set()
        # Включаем авто-одобрение через session_mgr
        longpoll.session_mgr.set_grant_mode(session_id, True)
        
        permission = {
            "id": "perm-no-prompt",
            "session_id": session_id,
            "permission": "write_file",
            "metadata": {"filepath": "/tmp/test.txt"}
        }
        
        await longpoll._process_permission(permission, session_id, 999)
        
        # mock_vk_client.send_message не должен вызываться для permission
        send_message_calls = [
            call for call in mock_vk_client.send_message.call_args_list
            if len(call.args) >= 2 and call.args[1].startswith("⚠️")
        ]
        assert len(send_message_calls) == 0, \
            "При авто-одобрении не должно отправляться сообщение с запросом разрешения"

    @pytest.mark.asyncio
    async def test_normal_mode_sends_permission_prompt(self, mock_vk_client, mock_opencode_client,
                                                        mock_opencode_process, temp_config_file):
        """При выключенном grant_mode должно отправляться сообщение пользователю"""
        from vk_longpoll import VKLongPoll
        from session_manager import SessionManager
        
        session_mgr = SessionManager(temp_config_file)
        longpoll = VKLongPoll(mock_vk_client, session_mgr, mock_opencode_process)
        longpoll.opencode_client = mock_opencode_client
        session_id = "test-session-normal-mode"
        longpoll.user_session[999] = session_id
        longpoll.seen_permissions[session_id] = set()
        # Выключаем авто-одобрение через session_mgr
        longpoll.session_mgr.set_grant_mode(session_id, False)
        
        permission = {
            "id": "perm-normal-456",
            "session_id": session_id,
            "permission": "write_file",
            "metadata": {"filepath": "/tmp/test.txt"}
        }
        
        await longpoll._process_permission(permission, session_id, 999)
        
        # Должно быть отправлено сообщение пользователю
        mock_vk_client.send_message.assert_called_once()
        
        # Проверка, что сообщение содержит запрос разрешения
        call_args = mock_vk_client.send_message.call_args
        message_text = call_args[0][1]
        assert "Запрос разрешения" in message_text, \
            "Сообщение должно содержать 'Запрос разрешения'"
        
        # send_permission_response НЕ должен вызываться
        mock_opencode_client.send_permission_response.assert_not_called()
