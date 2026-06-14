"""
HTTP клиент для OpenCode API
"""
import json
from typing import Dict, List, Optional

from aiohttp import ClientSession, ClientTimeout

import config
from logging_config import logger
from models import model_to_api_format


# Таймауты для разных типов запросов
DEFAULT_TIMEOUT = ClientTimeout(total=30)
SHORT_TIMEOUT = ClientTimeout(total=10)


class OpenCodeClient:
    """HTTP клиент для работы с OpenCode API."""

    def __init__(self, base_url: str = None):
        self.base_url = base_url or config.OPENCODE_URL
        self._session: Optional[ClientSession] = None

    async def __aenter__(self):
        self._session = ClientSession(timeout=DEFAULT_TIMEOUT)
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self._session:
            await self._session.close()

    @property
    def session(self) -> ClientSession:
        if self._session is None:
            raise RuntimeError("OpenCodeClient not initialized. Use 'async with' context manager.")
        return self._session

    # ---------- Сессии ----------

    async def create_session(self, model: str = None) -> str:
        """Создаёт новую сессию и возвращает её ID."""
        data = model_to_api_format(model or config.CLI_MODEL)
        async with self.session.post(f"{self.base_url}/api/session", json=data) as resp:
            resp.raise_for_status()
            resp_data = await resp.json()
            # API возвращает {data: {id: ...}}
            session_id = resp_data.get("data", resp_data).get("id")
            logger.debug(f"Created OpenCode session {session_id}")
            return session_id

    async def get_session_messages(
        self, session_id: str, limit: int = 20
    ) -> Optional[List[dict]]:
        """Получает сообщения сессии."""
        try:
            url = f"{self.base_url}/api/session/{session_id}/message?limit={limit}"
            async with self.session.get(url) as resp:
                if resp.status != 200:
                    return None
                resp_data = await resp.json()
                # API возвращает {data: [...], cursor: {...}}
                return resp_data.get("data", resp_data)
        except Exception as e:
            logger.warning(f"Failed to fetch messages for {session_id}: {e}")
            return None

    async def send_prompt(
        self, session_id: str, text: str
    ) -> bool:
        """Отправляет промпт в сессию."""
        url = f"{self.base_url}/api/session/{session_id}/prompt"
        # API требует формат {prompt: {text: "..."}}
        data = {"prompt": {"text": text}}
        async with self.session.post(url, json=data) as resp:
            if resp.status == 200:
                logger.debug(f"Prompt sent for session {session_id}")
                return True
            logger.error(f"Failed to send prompt: {resp.status}")
            return False

    # ---------- Разрешения ----------

    async def get_pending_permissions(self) -> List[dict]:
        """Получает список ожидающих разрешений."""
        try:
            async with self.session.get(f"{self.base_url}/api/permission/request") as resp:
                if resp.status != 200:
                    return []
                resp_data = await resp.json()
                # API возвращает {location: {...}, data: [...]}
                return resp_data.get("data", resp_data)
        except Exception as e:
            logger.warning(f"Error fetching permissions: {e}")
            return []

    async def send_permission_response(
        self, session_id: str, permission_id: str, response: str
    ) -> bool:
        """Отправляет ответ на запрос разрешения.

        response: "always" | "once" | "reject"
        """
        reply_map = {"always": "always", "once": "once", "never": "reject"}
        reply = reply_map.get(response, response)
        url = f"{self.base_url}/api/session/{session_id}/permission/{permission_id}/reply"
        data = {"reply": reply}
        async with self.session.post(url, json=data) as resp:
            if resp.status in (200, 204):
                logger.debug(f"Permission {permission_id} answered: {reply}")
                return True
            logger.error(f"Failed to reply to permission: {resp.status}")
            return False

    # ---------- Вопросы ----------

    async def get_pending_questions(self) -> List[dict]:
        """Получает список ожидающих вопросов."""
        try:
            async with self.session.get(f"{self.base_url}/api/question/request") as resp:
                if resp.status != 200:
                    return []
                resp_data = await resp.json()
                # API возвращает {location: {...}, data: [...]}
                return resp_data.get("data", resp_data)
        except Exception as e:
            logger.warning(f"Error fetching questions: {e}")
            return []

    async def send_question_answer(
        self, session_id: str, question_id: str, answer: str
    ) -> bool:
        """Отправляет ответ на вопрос."""
        url = f"{self.base_url}/api/session/{session_id}/question/{question_id}/reply"
        data = {"answers": [[answer]]}
        async with self.session.post(url, json=data) as resp:
            if resp.status in (200, 204):
                logger.debug(f"Answered question {question_id} with '{answer}'")
                return True
            logger.error(f"Failed to reply to question: {resp.status}")
            return False

    # ---------- Список сессий ----------

    async def get_all_sessions(self) -> List[dict]:
        """Получает список всех сессий."""
        try:
            async with self.session.get(f"{self.base_url}/api/session") as resp:
                if resp.status != 200:
                    return []
                resp_data = await resp.json()
                # API возвращает {data: [...], cursor: {...}}
                return resp_data.get("data", resp_data)
        except Exception as e:
            logger.warning(f"Error fetching sessions list: {e}")
            return []

    async def get_child_sessions(self, parent_id: str) -> List[dict]:
        """Получает список дочерних сессий (subagent/subtask)."""
        all_sessions = await self.get_all_sessions()
        return [s for s in all_sessions if s.get("parentID") == parent_id]
