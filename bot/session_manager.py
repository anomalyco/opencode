"""
Управление сессиями OpenCode
"""
import json
from pathlib import Path
from typing import Dict, List, Optional

from aiohttp import ClientSession

from config import OPENCODE_URL, SESSION_FILE, CLI_MODEL
from logging_config import logger
from models import model_to_api_format


class SessionManager:
    """Управление сессиями пользователей OpenCode."""

    def __init__(self, file_path: Path):
        self.file_path = file_path
        self.sessions: Dict[int, str] = {}
        self.seen_messages: Dict[str, set] = {}
        self.grant_mode: Dict[str, bool] = {}
        self.session_workdir: Dict[str, str] = {}  # session_id -> workdir path
        self.child_sessions: Dict[str, str] = {}  # child_session_id -> parent_session_id
        self._load()

    def _load(self) -> None:
        try:
            with open(self.file_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                self.sessions = {int(k): v for k, v in data.get("sessions", {}).items()}
                self.seen_messages = {
                    sid: set(ids) for sid, ids in data.get("seen_messages", {}).items()
                }
                self.grant_mode = {
                    sid: bool(val) for sid, val in data.get("grant_mode", {}).items()
                }
                self.session_workdir = {
                    sid: str(val) for sid, val in data.get("session_workdir", {}).items()
                }
                self.child_sessions = {
                    sid: str(val) for sid, val in data.get("child_sessions", {}).items()
                }
        except (FileNotFoundError, json.JSONDecodeError):
            self.sessions = {}
            self.seen_messages = {}
            self.grant_mode = {}
            self.session_workdir = {}
            self.child_sessions = {}

    def _save(self) -> None:
        data = {
            "sessions": {str(k): v for k, v in self.sessions.items()},
            "seen_messages": {
                sid: list(ids) for sid, ids in self.seen_messages.items()
            },
            "grant_mode": dict(self.grant_mode),
            "session_workdir": dict(self.session_workdir),
            "child_sessions": dict(self.child_sessions),
        }
        with open(self.file_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)

    async def get_or_create(self, user_id: int) -> str:
        if user_id in self.sessions:
            return self.sessions[user_id]

        async with ClientSession() as session:
            data = model_to_api_format(CLI_MODEL)
            async with session.post(f"{OPENCODE_URL}/api/session", json=data) as resp:
                resp.raise_for_status()
                resp_data = await resp.json()
                # API возвращает {data: {id: ...}}
                session_id = resp_data.get("data", resp_data).get("id")
                self.sessions[user_id] = session_id
                if session_id not in self.seen_messages:
                    self.seen_messages[session_id] = set()
                if session_id not in self.grant_mode:
                    self.grant_mode[session_id] = False
                self._save()
                logger.info(
                    f"Created OpenCode session {session_id} for user {user_id} with model {CLI_MODEL}"
                )
                return session_id

    def get_seen_messages(self, session_id: str) -> set:
        return self.seen_messages.get(session_id, set())

    def add_seen_message(self, session_id: str, message_id: str):
        if session_id not in self.seen_messages:
            self.seen_messages[session_id] = set()
        self.seen_messages[session_id].add(message_id)
        logger.debug(f"Saved seen message {message_id} to file for session {session_id}")
        self._save()

    def remove(self, user_id: int):
        if user_id in self.sessions:
            session_id = self.sessions[user_id]
            del self.sessions[user_id]
            if session_id in self.seen_messages:
                del self.seen_messages[session_id]
            if session_id in self.grant_mode:
                del self.grant_mode[session_id]
            self._save()
            logger.info(f"Removed session for user {user_id}")

    def get_grant_mode(self, session_id: str) -> bool:
        """Получает состояние режима авто-разрешений для сессии"""
        return self.grant_mode.get(session_id, False)

    def set_grant_mode(self, session_id: str, enabled: bool) -> None:
        """Устанавливает состояние режима авто-разрешений для сессии"""
        # BUG: не проверяет, существует ли сессия
        if session_id not in self.grant_mode:
            self.grant_mode[session_id] = False
        self.grant_mode[session_id] = enabled
        self._save()
        logger.debug(f"Grant mode for session {session_id}: {enabled}")

    def set_session_workdir(self, session_id: str, workdir: Path) -> None:
        """Устанавливает рабочую директорию для сессии"""
        self.session_workdir[session_id] = str(workdir)
        self._save()
        logger.debug(f"Session {session_id} workdir: {workdir}")

    def get_session_workdir(self, session_id: str) -> Optional[Path]:
        """Получает рабочую директорию для сессии"""
        path = self.session_workdir.get(session_id)
        if path:
            return Path(path)
        return None

    def remove_session(self, user_id: int):
        """Удаляет сессию пользователя, включая workdir и дочерние сессии"""
        if user_id in self.sessions:
            session_id = self.sessions[user_id]
            del self.sessions[user_id]
            if session_id in self.seen_messages:
                del self.seen_messages[session_id]
            if session_id in self.grant_mode:
                del self.grant_mode[session_id]
            if session_id in self.session_workdir:
                del self.session_workdir[session_id]

            # Удаляем записи о дочерних сессиях
            for child_id in list(self.child_sessions.keys()):
                if self.child_sessions[child_id] == session_id:
                    del self.child_sessions[child_id]

            self._save()
            logger.info(f"Removed session for user {user_id}")

    # ---------- Child sessions ----------

    def get_child_sessions(self, parent_id: str) -> List[str]:
        """Получает список дочерних сессий для родительской сессии"""
        return [child_id for child_id, par_id in self.child_sessions.items() if par_id == parent_id]

    def is_child_of(self, session_id: str, parent_id: str) -> bool:
        """Проверяет, является ли сессия дочерней для указанной родительской"""
        return self.child_sessions.get(session_id) == parent_id

    def register_child_session(self, child_session_id: str, parent_session_id: str) -> None:
        """Регистрирует дочернюю сессию"""
        if child_session_id not in self.child_sessions:
            self.child_sessions[child_session_id] = parent_session_id
            self._save()
            logger.debug(f"Registered child session {child_session_id} -> parent {parent_session_id}")

    def remove_child_session(self, child_session_id: str) -> None:
        """Удаляет запись о дочерней сессии"""
        if child_session_id in self.child_sessions:
            del self.child_sessions[child_session_id]
            logger.debug(f"Removed child session {child_session_id}")
