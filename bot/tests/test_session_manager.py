"""
Тесты для SessionManager - persistence grant_mode
"""
import pytest
import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch


class TestSessionManagerGrantModeInit:
    """Тесты: инициализация grant_mode при создании сессии"""

    @pytest.mark.asyncio
    async def test_grant_mode_initialized_on_session_create(self, temp_config_file):
        """
        BUG: При создании сессии через get_or_create, grant_mode не инициализируется.
        Это приводит к тому, что set_grant_mode возвращает None (не сохраняет).
        """
        from session_manager import SessionManager
        
        session_manager = SessionManager(temp_config_file)
        
        # Имитируем создание новой сессии
        mock_resp_data = {"id": "test-session-id"}
        
        with patch('session_manager.ClientSession') as mock_session_class:
            mock_resp = MagicMock()
            mock_resp.status = 200
            mock_resp.json = AsyncMock(return_value=mock_resp_data)
            mock_resp.__aenter__ = AsyncMock(return_value=mock_resp)
            mock_resp.__aexit__ = AsyncMock(return_value=None)
            
            mock_post = MagicMock()
            mock_post.return_value = mock_resp
            
            mock_session = MagicMock()
            mock_session.post = mock_post
            mock_session.__aenter__ = AsyncMock(return_value=mock_session)
            mock_session.__aexit__ = AsyncMock(return_value=None)
            
            mock_session_class.return_value = mock_session
            
            # Получаем/создаём сессию
            session_id = await session_manager.get_or_create(user_id=999)
            
            # BUG: grant_mode не должен быть пустым, должна быть запись для сессии
            assert session_id in session_manager.grant_mode, \
                "grant_mode должен быть инициализирован при создании сессии"
            assert session_manager.grant_mode[session_id] == False, \
                "grant_mode должен быть False по умолчанию"

    @pytest.mark.asyncio
    async def test_set_grant_mode_works_after_session_create(self, temp_config_file):
        """
        BUG: Если grant_mode не инициализирован, set_grant_mode возвращает None.
        """
        from session_manager import SessionManager
        
        session_manager = SessionManager(temp_config_file)
        
        mock_resp_data = {"id": "test-session-id-2"}
        
        with patch('session_manager.ClientSession') as mock_session_class:
            mock_resp = MagicMock()
            mock_resp.status = 200
            mock_resp.json = AsyncMock(return_value=mock_resp_data)
            mock_resp.__aenter__ = AsyncMock(return_value=mock_resp)
            mock_resp.__aexit__ = AsyncMock(return_value=None)
            
            mock_post = MagicMock()
            mock_post.return_value = mock_resp
            
            mock_session = MagicMock()
            mock_session.post = mock_post
            mock_session.__aenter__ = AsyncMock(return_value=mock_session)
            mock_session.__aexit__ = AsyncMock(return_value=None)
            
            mock_session_class.return_value = mock_session
            
            session_id = await session_manager.get_or_create(user_id=998)
            
            # Устанавливаем grant_mode
            session_manager.set_grant_mode(session_id, True)
            
            # Проверяем, что значение сохранилось
            assert session_manager.get_grant_mode(session_id) == True, \
                "set_grant_mode должен устанавливать значение"


class TestSessionManagerGrantModePersistence:
    """Тесты: сохранение и загрузка grant_mode"""

    def test_save_load_grant_mode(self, temp_config_file):
        """grant_mode должен сохраняться и загружаться из файла"""
        from session_manager import SessionManager
        
        # Создаём менеджер и устанавливаем grant_mode
        session_manager = SessionManager(temp_config_file)
        # Сначала создаём сессии (иначе _save() очистит grant_mode)
        session_manager.sessions[1] = "session-1"
        session_manager.sessions[2] = "session-2"
        session_manager.grant_mode["session-1"] = True
        session_manager.grant_mode["session-2"] = False
        session_manager._save()
        
        # Создаём новый экземпляр и загружаем
        new_manager = SessionManager(temp_config_file)
        
        assert new_manager.grant_mode["session-1"] == True
        assert new_manager.grant_mode["session-2"] == False

    def test_save_preserves_grant_mode_for_dead_sessions(self, temp_config_file):
        """При сохранении grant_mode сохраняется для всех сессий, даже несуществующих.
        
        Это нужно для persistence — если пользователь снова создаст сессию,
        его grant_mode будет восстановлен.
        """
        from session_manager import SessionManager
        
        # Создаём сессию и устанавливаем grant_mode
        session_manager = SessionManager(temp_config_file)
        session_manager.sessions["user-1"] = "session-1"
        session_manager.grant_mode["session-1"] = True
        session_manager._save()
        
        # Удаляем сессию, но оставляем grant_mode
        del session_manager.sessions["user-1"]
        session_manager._save()
        
        # grant_mode сохраняется в памяти и в файле
        assert "session-1" in session_manager.grant_mode, \
            "grant_mode должен сохраняться для persistence"
        
        # Проверяем, что значение сохранено в файле
        with open(temp_config_file, 'r') as f:
            data = json.load(f)
        assert "session-1" in data.get("grant_mode", {}), \
            "grant_mode должен быть сохранён в файле"

    def test_load_merges_existing_grant_mode(self, temp_config_file):
        """При загрузке должен использоваться существующий grant_mode из файла"""
        from session_manager import SessionManager
        
        # Записываем grant_mode в файл
        data = {
            "sessions": {"1": "session-existing"},
            "seen_messages": {},
            "grant_mode": {"session-existing": True}
        }
        with open(temp_config_file, 'w') as f:
            json.dump(data, f)
        
        # Перезагружаем
        session_manager = SessionManager(temp_config_file)
        
        assert session_manager.grant_mode["session-existing"] == True


class TestSessionManagerGrantModeCleanup:
    """Тесты: очистка grant_mode при удалении сессии"""

    def test_remove_session_clears_grant_mode(self, temp_config_file):
        """При удалении сессии должен удаляться grant_mode"""
        from session_manager import SessionManager
        
        session_manager = SessionManager(temp_config_file)
        session_manager.sessions["user-1"] = "session-1"
        session_manager.grant_mode["session-1"] = True
        session_manager.remove("user-1")
        
        assert "user-1" not in session_manager.sessions
        assert "session-1" not in session_manager.grant_mode


class TestSessionManagerGrantModeBug:
    """
    Тесты для воспроизведения бага: set_grant_mode не сохраняет значение
    когда сессия не существует в self.sessions.
    
    BUG: В _save() фильтруется grant_mode и удаляются сессии, которых нет в self.sessions.
    Когда set_grant_mode() вызывается с session_id, которого нет в self.sessions,
    _save() удаляет этот entry из grant_mode.
    """

    def test_set_grant_mode_without_session_in_sessions(self, temp_config_file):
        """
        BUG: set_grant_mode() не сохраняет значение, если session_id нет в self.sessions.
        
        Это происходит потому, что _save() фильтрует grant_mode:
            valid_sessions = set(self.sessions.values())
            grant_mode = {sid: val for sid, val in self.grant_mode.items()
                         if sid in valid_sessions}
        
        При вызове set_grant_mode() с session_id, которого нет в self.sessions,
        _save() удаляет этот entry из grant_mode.
        """
        from session_manager import SessionManager
        
        session_manager = SessionManager(temp_config_file)
        
        # Вызываем set_grant_mode() с session_id, которого нет в self.sessions
        session_id = "test-session-without-user-mapping"
        session_manager.set_grant_mode(session_id, True)
        
        # BUG: после _save() внутри set_grant_mode() этот entry удаляется
        assert session_id in session_manager.grant_mode, \
            f"session_id {session_id} должен быть в grant_mode после set_grant_mode()"
        assert session_manager.grant_mode[session_id] == True, \
            f"grant_mode для {session_id} должен быть True"
    
    def test_set_grant_mode_persists_across_save_load(self, temp_config_file):
        """
        BUG: После set_grant_mode() без session в self.sessions,
        при загрузке нового экземпляра SessionManager значение не сохраняется.
        
        Это потому, что _save() удаляет entry из grant_mode если session_id
        нет в self.sessions.
        """
        from session_manager import SessionManager
        
        session_manager = SessionManager(temp_config_file)
        
        # Вызываем set_grant_mode() с session_id, которого нет в self.sessions
        session_id = "test-persistence-session"
        session_manager.set_grant_mode(session_id, True)
        
        # Проверяем, что значение установлено (но оно было удалено в _save())
        # BUG: это assertion упадёт, потому что _save() удалил entry
        assert session_manager.get_grant_mode(session_id) == True, \
            "Значение должно быть установлено"
        
        # Читаем файл напрямую - значение должно быть там
        with open(temp_config_file, 'r') as f:
            data = json.load(f)
        
        # BUG: grant_mode будет пустым, потому что _save() удалил entry
        assert session_id in data.get("grant_mode", {}), \
            f"session_id {session_id} должен быть в grant_mode в файле"
