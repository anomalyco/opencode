"""
Лонгполл слушатель VK
"""

import asyncio
import json
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from urllib.parse import urlencode

import aiohttp
from aiohttp import ClientSession, ClientTimeout

import vk_keyboards
import config as bot_config
from config import (
    ATTACHES_DIR,
    LLAMA_SERVER_PATH,
    LLAMA_SERVER_HOST,
    LONGPOLL_WAIT,
    SCRIPT_DIR,
    SESSION_FILE,
    SUBAGENT_PREFIX,
    THINKING_PEER_ID,
    getCwd,
)
from llama_server import do_restart, test_llama_server_speed
from logging_config import logger
from message_parser import get_new_parts
from models import get_current_model, model_to_api_format
from nvidia import get_gpu_info_vk_message
from opencode_client import OpenCodeClient
from opencode_process import OpenCodeProcess
from session_manager import SessionManager
from vk_client import VKClient

# Константы
POLL_INTERVAL = 4  # интервал опроса сессии (секунды)


def extract_command(text: str) -> str:
    """
    Извлекает команду из текста, игнорируя упоминания групп.
    Форматы: '@club123 /help' или '[club123|@club123] /help'
    """
    text = text.strip()

    # Если есть упоминание группы в формате [club...|@...] или [public...|@...]
    if text.startswith("["):
        end = text.find("]")
        if end != -1:
            return text[end + 1:].strip()

    # Если есть упоминание группы @club... или @public...
    if text.startswith("@"):
        parts = text.split(None, 1)
        if len(parts) > 1:
            return parts[1].strip()

    return text


def _create_task_with_handler(coroutine, task_name: str = None):
    """
    Создаёт задачу с обработчиком ошибок.
    Возвращает саму задачу для возможного ожидания/отмены.
    """
    task = asyncio.create_task(coroutine)
    if task_name:
        task.set_name(task_name)

    def done_callback(t):
        try:
            exception = t.exception()
            if exception:
                logger.exception(f"Task {task_name or t.get_name()} failed: {exception}")
        except asyncio.CancelledError:
            pass  # Отмена задачи - это нормально

    task.add_done_callback(done_callback)
    return task


class VKLongPoll:
    """Лонгполл слушатель VK для обработки сообщений."""

    def __init__(
        self,
        vk: VKClient,
        session_mgr: SessionManager,
        opencode_process: OpenCodeProcess,
    ):
        self.vk = vk
        self.session_mgr = session_mgr
        self.opencode_process = opencode_process
        self.server = None
        self.key = None
        self.ts = None
        self.running = False

        # HTTP клиент для OpenCode API
        self.opencode_client: Optional[OpenCodeClient] = None

        # Управление поллерами
        self.session_pollers: Dict[str, asyncio.Task] = {}  # session_id -> poller_task
        self.user_session: Dict[int, str] = {}  # user_id -> session_id

        # Child session (subagent/subtask) tracking
        self.child_pollers: Dict[str, asyncio.Task] = {}  # child_session_id -> poller_task
        self.parent_child_map: Dict[str, Dict[str, dict]] = {}  # parent_id -> {child_id: {title, no_new, notified_start}}

        # Временные хранилища
        self.    waiting_for_answer: Dict = {}  # user_id -> question_id или (peer_id, child_id) -> question_id
        self.pending_permissions: Dict[str, Tuple[str, int, int]] = {}
        self.seen_permissions: Dict[str, set] = {}
        self.seen_questions: Dict[str, set] = {}

    # ---------- Управление поллерами ----------
    async def _start_session_poller(self, user_id: int, session_id: str):
        """Запускает поллер для конкретной сессии"""
        if session_id in self.session_pollers:
            logger.warning(f"Poller for session {session_id} already exists")
            return

        logger.debug(f"Starting poller for session {session_id} (user {user_id})")
        target_peer = THINKING_PEER_ID if THINKING_PEER_ID else user_id
        poller_task = _create_task_with_handler(
            self._poll_session_messages(user_id, session_id),
            task_name=f"poll_session_{session_id[:8]}"
        )
        self.session_pollers[session_id] = poller_task
        self.user_session[user_id] = session_id

        # Сразу проверяем существующие child сессии при старте поллера
        _create_task_with_handler(
            self._init_child_sessions(session_id, user_id, target_peer),
            task_name=f"init_child_sessions_{session_id[:8]}"
        )

    async def _stop_session_poller(self, session_id: str):
        """Останавливает поллер для сессии и все дочерние поллеры"""
        await self._stop_all_child_pollers(session_id)

        if session_id in self.session_pollers:
            logger.debug(f"Stopping poller for session {session_id}")
            self.session_pollers[session_id].cancel()
            try:
                await self.session_pollers[session_id]
            except asyncio.CancelledError:
                pass
            del self.session_pollers[session_id]

    async def _stop_user_poller(self, user_id: int):
        """Останавливает поллер для пользователя"""
        if user_id in self.user_session:
            session_id = self.user_session[user_id]
            await self._stop_session_poller(session_id)
            del self.user_session[user_id]

    # ---------- Управление child поллерами ----------
    async def _init_child_sessions(self, parent_id: str, user_id: int, target_peer: int):
        """При старте поллера проверяет активные child сессии из сохранённых и API"""
        # Сначала ищем живые child сессии через API
        new_children = await self._discover_new_child_sessions(parent_id, user_id, target_peer)
        if new_children:
            for child in new_children:
                child_id = child["id"]
                await self._start_child_poller(
                    child_id, parent_id, user_id, target_peer, child
                )

    async def _start_child_poller(
        self, child_id: str, parent_id: str, user_id: int, target_peer: int, child_info: dict
    ):
        """Запускает поллер для дочерней сессии"""
        if child_id in self.child_pollers or child_id in self.session_pollers:
            logger.warning(f"Poller for child session {child_id} already exists")
            return

        title = child_info.get("title", child_id[:12])
        self._ensure_session_seen_messages(child_id)

        if parent_id not in self.parent_child_map:
            self.parent_child_map[parent_id] = {}
        self.parent_child_map[parent_id][child_id] = {
            "title": title,
            "no_new": 0,
            "notified_start": False,
        }

        logger.debug(f"Starting child poller for {child_id} (title: {title})")
        poller_task = _create_task_with_handler(
            self._poll_child_messages(child_id, parent_id, user_id, target_peer),
            task_name=f"poll_child_{child_id[:8]}"
        )
        self.child_pollers[child_id] = poller_task
        self.session_pollers[child_id] = poller_task

        target = THINKING_PEER_ID if THINKING_PEER_ID else user_id
        await self.vk.send_message(
            target,
            f"🚀 Subagent started: {title}"
        )

    async def _stop_child_poller(self, child_id: str, parent_id: str):
        """Останавливает поллер для дочерней сессии"""
        if child_id in self.child_pollers:
            logger.debug(f"Stopping child poller for {child_id}")
            self.child_pollers[child_id].cancel()
            try:
                await self.child_pollers[child_id]
            except asyncio.CancelledError:
                pass
            del self.child_pollers[child_id]

        if child_id in self.session_pollers:
            del self.session_pollers[child_id]

        if parent_id in self.parent_child_map:
            self.parent_child_map[parent_id].pop(child_id, None)
            if not self.parent_child_map[parent_id]:
                del self.parent_child_map[parent_id]

        self.session_mgr.remove_child_session(child_id)

    async def _stop_all_child_pollers(self, parent_id: str):
        """Останавливает все дочерние поллеры для родительской сессии"""
        if parent_id in self.parent_child_map:
            for child_id in list(self.parent_child_map[parent_id].keys()):
                await self._stop_child_poller(child_id, parent_id)

    async def _poll_child_messages(
        self, child_id: str, parent_id: str, user_id: int, target_peer: int
    ):
        """Поллер для дочерней сессии"""
        try:
            while True:
                try:
                    messages = await self.opencode_client.get_session_messages(child_id)
                    if not messages:
                        await asyncio.sleep(POLL_INTERVAL)
                        continue

                    last_info = self._get_child_info(parent_id, child_id)

                    new_parts = self._get_new_message_parts(child_id, messages)

                    if not new_parts:
                        if last_info:
                            last_info["no_new"] += 1
                        if len(messages) > 0 and last_info and last_info["no_new"] >= 5:
                            logger.info(f"Child session {child_id} appears finished")
                            prefix = SUBAGENT_PREFIX
                            title = last_info.get("title", child_id[:12])
                            await self.vk.send_message(
                                target_peer,
                                f"🏁 Subagent finished: {title}"
                            )
                            await self._stop_child_poller(child_id, parent_id)
                            return
                        await asyncio.sleep(POLL_INTERVAL)
                        continue

                    if last_info:
                        last_info["no_new"] = 0

                    await self._send_new_parts_prefixed(
                        new_parts, user_id, target_peer, prefix=SUBAGENT_PREFIX
                    )

                    await self._check_child_permissions(child_id, parent_id, user_id, target_peer)
                    await asyncio.sleep(POLL_INTERVAL)
                except asyncio.CancelledError:
                    raise
                except Exception as e:
                    logger.warning(f"Child poller error for {child_id}: {e}")
                    await asyncio.sleep(POLL_INTERVAL)
        except asyncio.CancelledError:
            logger.info(f"Child poller stopped for {child_id}")
            raise

    def _get_child_info(self, parent_id: str, child_id: str) -> Optional[dict]:
        """Получает информацию о дочерней сессии"""
        if parent_id not in self.parent_child_map:
            return None
        return self.parent_child_map[parent_id].get(child_id)

    # ---------- Основной поллер сессии ----------
    async def _poll_session_messages(self, user_id: int, session_id: str):
        """Поллер для конкретной сессии - работает непрерывно"""
        logger.info(f"Poller started for session {session_id}")

        target_peer = THINKING_PEER_ID if THINKING_PEER_ID else user_id
        self._ensure_session_seen_messages(session_id)
        discovery_counter = 0

        try:
            while True:
                try:
                    await self._process_session_updates(
                        session_id, user_id, target_peer
                    )

                    # Периодическое обнаружение дочерних сессий
                    discovery_counter += 1
                    if discovery_counter % 15 == 0:
                        new_children = await self._discover_new_child_sessions(
                            session_id, user_id, target_peer
                        )
                        if new_children:
                            for child in new_children:
                                child_id = child["id"]
                                await self._start_child_poller(
                                    child_id, session_id, user_id, target_peer, child
                                )

                    await self._process_child_sessions(
                        session_id, user_id, target_peer
                    )
                    await asyncio.sleep(POLL_INTERVAL)
                except asyncio.CancelledError:
                    raise
                except Exception as e:
                    logger.warning(f"Poller error for session {session_id}: {e}")
                    await asyncio.sleep(POLL_INTERVAL)
        except asyncio.CancelledError:
            logger.info(f"Poller stopped for session {session_id}")
            raise

    def _ensure_session_seen_messages(self, session_id: str):
        """Гарантирует наличие словаря seen_messages для сессии"""
        if session_id not in self.session_mgr.seen_messages:
            self.session_mgr.seen_messages[session_id] = set()

    async def _process_session_updates(
        self, session_id: str, user_id: int, target_peer: int
    ):
        """Обрабатывает обновления для сессии"""
        messages = await self.opencode_client.get_session_messages(session_id)
        if not messages:
            return

        new_parts = self._get_new_message_parts(session_id, messages)
        await self._send_new_parts(new_parts, user_id, target_peer)

        await self._check_permissions(session_id, user_id)
        await self._check_questions(session_id, user_id)

    def _get_new_message_parts(self, session_id: str, messages: List[dict]) -> List:
        """Извлекает новые части сообщений"""
        new_parts = get_new_parts(messages, self.session_mgr.seen_messages[session_id])

        result_parts = []
        for part in new_parts:
            text = part.text
            # Если текст пустой (None или "") - игнорируем part полностью
            if text is None or text == "":
                logger.debug(f"Ignoring empty part: type={part.type}, id={part.id}")
                continue
            # Сохраняем в просмотренные (даже если только пробелы)
            self.session_mgr.add_seen_message(session_id, part.id)
            result_parts.append(part)

        return result_parts

    async def _send_new_parts(self, parts: List, user_id: int, target_peer: int):
        """Отправляет новые части сообщений пользователю"""
        for part in parts:
            await self._send_part_by_type(part, user_id, target_peer)

    async def _send_part_by_type(
        self, part, user_id: int, target_peer: int, prefix: str = ""
    ):
        """Отправляет часть сообщения в зависимости от ее типа"""
        text = part.text or ""
        if not text.strip():
            return

        if part.type == "tool":
            await self.vk.send_message(target_peer, f"{prefix}🧠: Tool\n{text}")
        elif part.type == "reasoning":
            await self.vk.send_message(target_peer, f"{prefix}🧠:\n{text}")
        elif prefix:
            await self.vk.send_message(target_peer, f"{prefix}{text}")
        else:
            dest = target_peer if prefix else user_id
            await self.vk.send_message(dest, f"{prefix}{text}")

    async def _send_new_parts_prefixed(
        self, parts: List, user_id: int, target_peer: int, prefix: str = ""
    ):
        """Отправляет новые части сообщений с префиксом"""
        for part in parts:
            await self._send_part_by_type(part, user_id, target_peer, prefix)

    async def _discover_new_child_sessions(
        self, parent_id: str, user_id: int, target_peer: int
    ) -> List[dict]:
        """Находит новые дочерние сессии для родительской сессии"""
        try:
            children = await self.opencode_client.get_child_sessions(parent_id)
        except Exception as e:
            logger.warning(f"Failed to discover child sessions: {e}")
            return []

        if parent_id not in self.parent_child_map:
            self.parent_child_map[parent_id] = {}

        new_children = []
        for child in children:
            child_id = child["id"]
            if child_id in self.parent_child_map[parent_id]:
                continue
            if self.session_mgr.is_child_of(child_id, parent_id):
                continue

            self.session_mgr.register_child_session(child_id, parent_id)
            new_children.append(child)

        return new_children

    async def _process_child_sessions(
        self, parent_id: str, user_id: int, target_peer: int
    ):
        """Проверяет дочерние сессии на завершение через список всех сессий"""
        if parent_id not in self.parent_child_map:
            return

        try:
            children = await self.opencode_client.get_child_sessions(parent_id)
        except Exception as e:
            logger.warning(f"Failed to check child sessions: {e}")
            return

        active_ids = {c["id"] for c in children}
        for child_id in list(self.parent_child_map[parent_id].keys()):
            if child_id not in active_ids and child_id not in self.child_pollers:
                await self._stop_child_poller(child_id, parent_id)

    # ---------- Обработка разрешений ----------
    async def _check_permissions(self, session_id: str, user_id: int):
        """Проверяет новые запросы разрешений"""
        permissions = await self.opencode_client.get_pending_permissions()
        if not permissions:
            return

        if session_id not in self.seen_permissions:
            self.seen_permissions[session_id] = set()

        for perm in permissions:
            await self._process_permission(perm, session_id, user_id)

        # Проверяем разрешения для дочерних сессий
        child_ids = self.session_mgr.get_child_sessions(session_id)
        for child_id in child_ids:
            for perm in permissions:
                await self._process_child_permission(perm, child_id, session_id, user_id)

    async def _process_permission(self, perm: dict, session_id: str, user_id: int):
        """Обрабатывает один запрос разрешения"""
        perm_id = perm.get("id")
        perm_session_id = perm.get("sessionID") or perm.get("session_id")

        if (
            perm_session_id != session_id
            or perm_id in self.seen_permissions[session_id]
        ):
            return

        self.seen_permissions[session_id].add(perm_id)

        perm_type = perm.get("action") or "unknown"
        resources = perm.get("resources", [])
        logger.debug(
            f"Permission request: type={perm_type}, resources={resources}, id={perm_id}"
        )

        # Авто-аппрув для /tmp — всегда разрешаем без запроса к пользователю
        if resources and all(r.startswith("/tmp") for r in resources):
            logger.info(f"Auto-approving /tmp permission {perm_id}")
            await self.opencode_client.send_permission_response(
                perm_session_id, perm_id, "always"
            )
            return

        # Если включён режим авто-разрешений — отвечаем всегда без запроса
        if self.session_mgr.get_grant_mode(session_id) and self.opencode_client:
            logger.debug(
                f"Auto-grant mode ON: approving permission {perm_id} ({perm_type})"
            )
            await self.opencode_client.send_permission_response(
                perm_session_id, perm_id, "always"
            )
            return

        msg = self._format_permission_message(perm)
        keyboard = self._create_permission_keyboard()
        msg_id = await self.vk.send_message(user_id, msg, keyboard=keyboard)

        self.pending_permissions[perm_id] = (session_id, user_id, msg_id)
        logger.info(f"Sent permission request {perm_id} to user {user_id}")

    def _format_permission_message(self, perm: dict) -> str:
        """Форматирует сообщение для запроса разрешения (новый формат v2 API).

        Формат API:
        - perm["action"] — тип операции (bash, write_file, read_file, etc.)
        - perm["resources"] — список ресурсов (путей)
        - perm["metadata"] — дополнительные данные (опционально)
        """
        import json

        perm_type = perm.get("action", "unknown")
        resources = perm.get("resources", [])
        path = resources[0] if resources else ""

        # Если path пустой, пробуем извлечь из metadata
        if not path:
            metadata = perm.get("metadata") or {}
            path = metadata.get("path", "") or metadata.get("filepath", "")

        # Fallback для external_directory: используем workdir
        if not path and perm_type == "external_directory":
            workdir = getattr(self.opencode_process, "workdir", None)
            if workdir:
                path = str(workdir)

        tool_name = perm_type

        # Формируем сообщение в зависимости от типа
        if perm_type == "external_directory":
            if path:
                return f"⚠️ **Запрос разрешения**\n\nТип: `{perm_type}`\n\nПрограмма хочет получить доступ к директории:\n`{path}`"
            else:
                return f"⚠️ **Запрос разрешения**\n\nТип: `{perm_type}`\n\nПрограмма хочет получить доступ к директории.\n\nДанные: `{json.dumps(perm, ensure_ascii=False)}`"
        elif perm_type in ("write_file", "edit", "multi_edit"):
            if path:
                return f"⚠️ **Запрос разрешения**\n\nИнструмент: `{tool_name}`\n\nПрограмма хочет записать файл:\n`{path}`"
            else:
                return f"⚠️ **Запрос разрешения**\n\nИнструмент: `{tool_name}`\n\nПрограмма хочет записать файл.\n\nДанные: `{json.dumps(perm, ensure_ascii=False)}`"
        elif perm_type in ("read_file", "view", "read"):
            if path:
                return f"⚠️ **Запрос разрешения**\n\nИнструмент: `{tool_name}`\n\nПрограмма хочет прочитать файл:\n`{path}`"
            else:
                return f"⚠️ **Запрос разрешения**\n\nИнструмент: `{tool_name}`\n\nПрограмма хочет прочитать файл.\n\nДанные: `{json.dumps(perm, ensure_ascii=False)}`"
        elif perm_type == "bash" or tool_name == "bash":
            params = perm.get("metadata") or {}
            command = params.get("command", params.get("cmd", "")) if isinstance(params, dict) else ""
            display = command or path
            if display:
                return f"⚠️ **Запрос разрешения**\n\nИнструмент: `bash`\n\nПрограмма хочет выполнить команду:\n`{display}`"
            else:
                return f"⚠️ **Запрос разрешения**\n\nИнструмент: `bash`\n\nПрограмма хочет выполнить команду.\n\nДанные: `{json.dumps(perm, ensure_ascii=False)}`"
        else:
            return f"⚠️ **Запрос разрешения**\n\nИнструмент: `{tool_name}`\n\nДанные: `{json.dumps(perm, ensure_ascii=False)}`"

    def _create_permission_keyboard(self) -> dict:
        """Создает клавиатуру для ответа на разрешение"""
        return vk_keyboards.get_permission_keyboard()

    async def _process_child_permission(
        self, perm: dict, child_id: str, parent_id: str, user_id: int
    ):
        """Обрабатывает запрос разрешения дочерней сессии"""
        perm_id = perm.get("id")
        perm_session_id = perm.get("sessionID") or perm.get("session_id")

        if perm_session_id != child_id:
            return

        if child_id not in self.seen_permissions:
            self.seen_permissions[child_id] = set()
        if perm_id in self.seen_permissions[child_id]:
            return

        self.seen_permissions[child_id].add(perm_id)

        resources = perm.get("resources", [])

        # Авто-аппрув для /tmp
        if resources and all(r.startswith("/tmp") for r in resources):
            logger.info(f"Auto-approving /tmp child permission {perm_id}")
            await self.opencode_client.send_permission_response(
                perm_session_id, perm_id, "always"
            )
            return

        if self.session_mgr.get_grant_mode(parent_id) and self.opencode_client:
            logger.debug(f"Auto-grant (parent): approving child permission {perm_id}")
            await self.opencode_client.send_permission_response(
                perm_session_id, perm_id, "always"
            )
            return

        child_title = child_id[:12]
        for ch_id, ch_info in self.parent_child_map.get(parent_id, {}).items():
            if ch_id == child_id:
                child_title = ch_info.get("title", child_id[:12])
                break

        perm_type = perm.get("action") or "unknown"
        perm_path = resources[0] if resources else ""
        msg = (
            f"{SUBAGENT_PREFIX}⚠️ **Запрос разрешения (subagent)**\n\n"
            f"Subagent: {child_title}\n"
            f"Тип: `{perm_type}`\n"
            f"Путь: `{perm_path}`"
        )
        keyboard = self._create_permission_keyboard()
        target_peer = THINKING_PEER_ID if THINKING_PEER_ID else user_id
        msg_id = await self.vk.send_message(target_peer, msg, keyboard=keyboard)
        self.pending_permissions[perm_id] = (child_id, target_peer, msg_id)
        logger.info(f"Sent child permission request {perm_id} for subagent {child_title}")

    async def _check_child_permissions(
        self, child_id: str, parent_id: str, user_id: int, target_peer: int
    ):
        """Проверяет разрешения для дочерней сессии (вызывается из child poller)"""
        permissions = await self.opencode_client.get_pending_permissions()
        if not permissions:
            return

        if child_id not in self.seen_permissions:
            self.seen_permissions[child_id] = set()

        for perm in permissions:
            perm_id = perm.get("id")
            perm_session_id = perm.get("sessionID") or perm.get("session_id")
            if perm_session_id != child_id or perm_id in self.seen_permissions[child_id]:
                continue

            self.seen_permissions[child_id].add(perm_id)

            if self.session_mgr.get_grant_mode(parent_id) and self.opencode_client:
                await self.opencode_client.send_permission_response(
                    perm_session_id, perm_id, "always"
                )
                continue

            child_title = child_id[:12]
            for ch_id, ch_info in self.parent_child_map.get(parent_id, {}).items():
                if ch_id == child_id:
                    child_title = ch_info.get("title", child_id[:12])
                    break

            perm_type = perm.get("permission") or perm.get("action") or "unknown"
            msg = (
                f"{SUBAGENT_PREFIX}⚠️ **Запрос разрешения (subagent: {child_title})**\n\n"
                f"Тип: `{perm_type}`"
            )
            keyboard = self._create_permission_keyboard()
            msg_id = await self.vk.send_message(target_peer, msg, keyboard=keyboard)
            self.pending_permissions[perm_id] = (child_id, target_peer, msg_id)

    # ---------- Обработка вопросов ----------
    async def _check_questions(self, session_id: str, user_id: int):
        """Проверяет новые вопросы от OpenCode"""
        questions = await self.opencode_client.get_pending_questions()
        if not questions:
            return

        if session_id not in self.seen_questions:
            self.seen_questions[session_id] = set()

        for q in questions:
            await self._process_question(q, session_id, user_id)

        # Проверяем вопросы для дочерних сессий
        child_ids = self.session_mgr.get_child_sessions(session_id)
        for child_id in child_ids:
            for q in questions:
                await self._process_child_question(q, child_id, session_id, user_id)

    async def _process_question(self, q: dict, session_id: str, user_id: int):
        """Обрабатывает один вопрос"""
        q_id = q.get("id")
        q_session_id = q.get("sessionID") or q.get("session_id")

        if q_session_id != session_id or q_id in self.seen_questions[session_id]:
            return

        self.seen_questions[session_id].add(q_id)
        logger.info(f"Found new question {q_id} for session {session_id}")

        actual_question = q.get("questions", [{}])[0] if q.get("questions") else q
        await self._show_question(user_id, actual_question, original_id=q_id, session_id=session_id)

    async def _show_question(
        self, user_id: int, question_data: dict, original_id: str = None, session_id: str = None
    ):
        """Показывает вопрос пользователю с клавиатурой"""
        question_id = (
            original_id or question_data.get("id") or question_data.get("question_id")
        )
        if not question_id:
            logger.error("No question_id in question_data")
            return

        header, question_text, options = self._extract_question_data(question_data)

        self.waiting_for_answer[user_id] = (session_id, question_id)

        try:
            keyboard = vk_keyboards.get_question_keyboard(options)
            text = f"🔧 {header}\n\n{question_text}"
            await self.vk.send_message(user_id, text, keyboard=keyboard)
            logger.info(f"Sent question {question_id} to user {user_id}")
        except Exception as e:
            logger.error(f"Failed to send question keyboard: {e}")
            await self._send_question_fallback(user_id, header, question_text, options)

    def _extract_question_data(
        self, question_data: dict
    ) -> Tuple[str, str, List[dict]]:
        """Извлекает заголовок, текст и опции из данных вопроса"""
        header = question_data.get("header") or question_data.get("title") or "Вопрос"

        question_text = (
            question_data.get("question")
            or question_data.get("text")
            or question_data.get("description")
            or question_data.get("prompt")
            or ""
        )

        if not question_text:
            metadata = question_data.get("metadata") or {}
            question_text = (
                metadata.get("question")
                or metadata.get("text")
                or ""
            )

        options = question_data.get("options", [])
        if not options:
            metadata = question_data.get("metadata") or {}
            options = metadata.get("options", [])
        if not options and "choices" in question_data:
            options = question_data["choices"]

        if options and isinstance(options[0], str):
            options = [{"label": opt} for opt in options]

        if not options:
            options = [{"label": "✅ Да"}, {"label": "❌ Нет"}]
            if not question_text:
                question_text = "Пожалуйста, выберите вариант"

        return header, question_text, options

    async def _send_question_fallback(
        self, user_id: int, header: str, question_text: str, options: List[dict]
    ):
        """Запасной вариант отправки вопроса обычным текстом"""
        options_text = ", ".join([opt["label"] for opt in options])
        await self.vk.send_message(
            user_id,
            f"❌ Ошибка отображения вопроса. Пожалуйста, ответьте текстом.\n\n"
            f"{header}\n{question_text}\nВарианты: {options_text}",
        )

    async def _process_child_question(
        self, q: dict, child_id: str, parent_id: str, user_id: int
    ):
        """Обрабатывает вопрос дочерней сессии"""
        q_id = q.get("id")
        q_session_id = q.get("sessionID") or q.get("session_id")

        if q_session_id != child_id:
            return

        if child_id not in self.seen_questions:
            self.seen_questions[child_id] = set()
        if q_id in self.seen_questions[child_id]:
            return

        self.seen_questions[child_id].add(q_id)

        child_title = child_id[:12]
        for ch_id, ch_info in self.parent_child_map.get(parent_id, {}).items():
            if ch_id == child_id:
                child_title = ch_info.get("title", child_id[:12])
                break

        actual_question = q.get("questions", [{}])[0] if q.get("questions") else q
        target_peer = THINKING_PEER_ID if THINKING_PEER_ID else user_id

        header = actual_question.get("header") or actual_question.get("title") or "Вопрос"
        question_text = (
            actual_question.get("question")
            or actual_question.get("text")
            or actual_question.get("description")
            or ""
        )

        msg = f"{SUBAGENT_PREFIX}🔧 **Вопрос (subagent: {child_title})**\n\n{header}\n\n{question_text}"
        options = actual_question.get("options", [])
        if options and isinstance(options[0], str):
            options = [{"label": opt} for opt in options]

        if options:
            try:
                keyboard = vk_keyboards.get_question_keyboard(options)
                await self.vk.send_message(target_peer, msg, keyboard=keyboard)
            except Exception:
                options_text = ", ".join([opt["label"] for opt in options])
                await self.vk.send_message(
                    target_peer,
                    f"{msg}\nВарианты: {options_text} (ответьте текстом)",
                )
        else:
            await self.vk.send_message(target_peer, f"{msg}\n\nОтветьте текстом")

        # Ключ (target_peer, child_id) чтобы не было конфликта с родительскими вопросами
        self.waiting_for_answer[(target_peer, child_id)] = q_id
        logger.info(f"Sent child question {q_id} for subagent {child_title}")

    async def _handle_question_answer(
        self, user_id: int, question_id: str, answer: str, session_id: str = None
    ):
        """Обрабатывает ответ пользователя на вопрос"""
        success = await self.opencode_client.send_question_answer(session_id, question_id, answer)
        if success:
            await self.vk.send_message(
                user_id,
                f"✅ Вы выбрали: {answer}",
                keyboard=vk_keyboards.get_main_keyboard(),
            )
        else:
            await self.vk.send_message(
                user_id,
                "❌ Ошибка отправки ответа",
                keyboard=vk_keyboards.get_main_keyboard(),
            )

    # ---------- Обработка команд ----------
    async def _get_long_poll_events(self) -> Tuple[List[dict], int, Optional[int]]:
        """Получает события из long poll.
        Возвращает (updates, ts, failed_code). failed_code=None если всё ок.
        """
        params = {
            "act": "a_check",
            "key": self.key,
            "ts": self.ts,
            "wait": LONGPOLL_WAIT,
            "mode": 74,
            "version": 3,
        }
        url = f"https://{self.server}?{urlencode(params)}"
        timeout = ClientTimeout(total=LONGPOLL_WAIT + 10)
        async with ClientSession(timeout=timeout) as session:
            async with session.get(url) as resp:
                data = await resp.json()
                if "failed" in data:
                    failed_code = data.get("failed")
                    error_msg = data.get("error", "unknown error")
                    return [], self.ts, failed_code
                return data.get("updates", []), int(data["ts"]), None

    async def _refresh_long_poll_server(self):
        """Обновляет сервер long poll"""
        self.server, self.key, self.ts = await self.vk.get_long_poll_server()
        logger.info(f"Long Poll server refreshed: {self.server}")

    async def _refresh_long_poll_server_with_retry(self):
        """Обновляет сервер long poll с ретраем при ошибке соединения (каждые 30 сек)"""
        while self.running:
            try:
                await self._refresh_long_poll_server()
                return
            except (aiohttp.ClientError, asyncio.TimeoutError, OSError) as e:
                logger.warning(f"Failed to refresh long poll server: {e}. Retrying in 30 seconds...")
                await asyncio.sleep(30)

    async def _handle_message_new(self, event: list):
        """Обрабатывает новое сообщение"""
        msg_id = int(event[1])
        flags = int(event[2])
        peer_id = int(event[3])
        text = event[5] if len(event) > 5 else ""

        if flags & 2:
            return

        user_id = peer_id
        logger.info(f"New message from {user_id}: text='{text[:50]}...'")

        # Пропускаем сообщения из thinking_peer_id
        if THINKING_PEER_ID and peer_id == THINKING_PEER_ID:
            logger.debug(f"Ignoring message from thinking_peer_id {peer_id}")
            return

        # Извлекаем команду, убирая упоминание группы
        cmd = extract_command(text)

        if cmd == "/start":
            return
        if cmd == "/update":
            return

        # Игнорируем команды gateway-restarter.py (не отправлять в OpenCode)
        if cmd in ("/b", "/branch"):
            return

        # /n и /newsession обрабатываются как команда бота, не отправляются модели
        # cmd может быть "/n", "/n /path", "/newsession", "/newsession /path" (из группы)
        if cmd == "/n" or cmd.startswith("/n ") or cmd.startswith("/newsession"):
            # Извлекаем аргументы после команды (например, путь к директории)
            parts = cmd.split(None, 1)
            args = parts[1] if len(parts) > 1 else ""
            await self._handle_new_session_command(user_id, args)
            return

        if cmd.startswith("/restart") or cmd.startswith("/r"):
            await self._handle_restart_command(user_id, cmd)
            return

        if cmd == "/status":
            await self._handle_status_command(user_id)
            return

        if cmd.startswith("/models") or cmd == "/m":
            await self._handle_models_command(user_id)
            return

        if cmd.startswith("/history"):
            await self._handle_history_command(user_id, cmd)
            return

 
        if cmd == "/sessions":
            await self._handle_sessions_command(user_id)
            return

        if cmd.startswith("/logs"):
            await self._handle_logs_command(user_id)
            return

        if cmd == "/help":
            await self._send_help(user_id)
            return

        if cmd == "/gpu":
            await self._handle_gpu_command(user_id)
            return

        if cmd == "/clean_attaches":
            await self._handle_clean_attaches_command(user_id)
            return

        if cmd == "/test-llama":
            await self._handle_test_llama_command(user_id, cmd)
            return

        if cmd.startswith("/config"):
            await self._handle_config_command(user_id, cmd)
            return

        if cmd.startswith("/grant"):
            await self._handle_grant_command(user_id, cmd)
            return

        # Обработка ответов на вопросы (родительские и дочерние)
        # Сначала проверяем parent (int ключ)
        if user_id in self.waiting_for_answer:
            session_id, question_id = self.waiting_for_answer.pop(user_id)
            await self._handle_question_answer(user_id, question_id, text, session_id)
            return

        # Проверяем child вопросы (кортеж ключ (peer_id, child_id))
        for key in list(self.waiting_for_answer.keys()):
            if isinstance(key, tuple) and len(key) == 2 and key[0] == user_id:
                question_id = self.waiting_for_answer.pop(key)
                await self._handle_question_answer(user_id, question_id, text)
                return

        # Обработка ответов на разрешения
        for permission_id, perm_data in list(self.pending_permissions.items()):
            perm_session_id, perm_user_id, perm_msg_id = perm_data
            if perm_user_id == user_id:
                answer = text.strip().lower()
                response = None
                result_text = None

                if "✅" in answer or "навсегда" in answer:
                    response = "always"
                    result_text = "✅ Разрешение предоставлено навсегда"
                elif "🔄" in answer or "разово" in answer:
                    response = "once"
                    result_text = "🔄 Разрешение предоставлено разово"
                elif "❌" in answer or "никогда" in answer:
                    response = "never"
                    result_text = "❌ Разрешение отклонено навсегда"
                else:
                    continue

                await self.opencode_client.send_permission_response(
                    perm_session_id, permission_id, response
                )
                await self.vk.edit_message(
                    peer_id=user_id,
                    message_id=perm_msg_id,
                    text=result_text,
                    keyboard=vk_keyboards.get_main_keyboard(),
                )
                del self.pending_permissions[permission_id]
                return

        # Обычное сообщение
        full_msgs = await self.vk.get_messages_by_ids([msg_id])
        if not full_msgs:
            return
        full_msg = full_msgs[0]
        await self._handle_user_message(user_id, full_msg)

    async def _handle_user_message(self, user_id: int, message: dict):
        """Обрабатывает обычное сообщение пользователя"""
        text = message.get("text", "")
        attachments = message.get("attachments", [])

        logger.debug(
            f"Message from {user_id}: text_len={len(text)}, attachments_count={len(attachments)}"
        )

        session_id = await self.session_mgr.get_or_create(user_id)

        # Останавливаем старый поллер если сессия изменилась
        if user_id in self.user_session and self.user_session[user_id] != session_id:
            await self._stop_user_poller(user_id)

        # Запускаем поллер если еще не запущен
        if session_id not in self.session_pollers:
            await self._start_session_poller(user_id, session_id)

        # Обрабатываем аттачи
        attachment_info = ""
        if attachments:
            logger.debug(
                f"Processing {len(attachments)} attachment(s) for user {user_id}"
            )
            for att in attachments:
                logger.debug(f"Attachment type: {att.get('type')}")
            downloaded = await self.vk.download_attachments(attachments, ATTACHES_DIR)
            if downloaded:
                attachment_info = self._format_attachment_info(downloaded)
                logger.debug(
                    f"Downloaded {len(downloaded)} attachments for user {user_id}"
                )
            else:
                logger.debug(
                    f"No attachments were downloaded (count={len(attachments)})"
                )

        # Формируем полный текст с информацией об аттачах
        full_text = text
        if attachment_info:
            if text:
                full_text = f"{text}\n\n{attachment_info}"
            else:
                full_text = attachment_info

        # Отправляем запрос в OpenCode
        success = await self.opencode_client.send_prompt(session_id, full_text)
        if not success:
            await self.vk.send_message(user_id, "❌ Ошибка отправки запроса")

    def _format_attachment_info(self, attachments: List[dict]) -> str:
        """Форматирует информацию об аттачах для отправки в OpenCode"""
        lines = [f"📥 Downloaded {len(attachments)} file(s):"]
        for att in attachments:
            att_type = att.get("type", "unknown")
            filename = att.get("filename", "unknown")
            path = att.get("path", "")
            lines.append(f"• [{att_type}] `{filename}` saved to: `{path}`")
        return "\n".join(lines)

    async def _handle_restart_command(self, user_id: int, text: str):
        """Обрабатывает команду /restart"""
        parts = text.strip().split()
        model_alias = parts[1] if len(parts) > 1 else None

        # Сохраняем текущий workdir до удаления сессии
        old_session_id = self.session_mgr.sessions.get(user_id)
        saved_workdir = None
        if old_session_id:
            saved_workdir = self.session_mgr.get_session_workdir(old_session_id)
        # Если нет workdir в сессии, берем из opencode_process
        if not saved_workdir:
            saved_workdir = getattr(self.opencode_process, "workdir", None)

        model_info, error = await do_restart(
            self.vk,
            user_id,
            model_alias,
            opencode_process=self.opencode_process,
            session_mgr=self.session_mgr,
            current_default=bot_config.DEFAULT_MODEL,
        )

        if error:
            await self.vk.send_message(user_id, f"❌ {error}")
        else:
            # Создаем новую сессию с сохранением workdir
            if saved_workdir:
                self.opencode_process.workdir = saved_workdir

            new_session_id = await self.opencode_client.create_session()
            self.session_mgr.sessions[user_id] = new_session_id
            if new_session_id not in self.session_mgr.seen_messages:
                self.session_mgr.seen_messages[new_session_id] = set()
            if new_session_id not in self.session_mgr.grant_mode:
                self.session_mgr.grant_mode[new_session_id] = False
            if saved_workdir:
                self.session_mgr.set_session_workdir(new_session_id, saved_workdir)
            self.session_mgr._save()

            await self._stop_user_poller(user_id)
            await self._start_session_poller(user_id, new_session_id)

            await self.vk.send_message(user_id, f"✅ Модель {model_info} загружена")

    async def _handle_status_command(self, user_id: int):
        """Обрабатывает команду /status - показывает текущий статус бота"""
        status_lines = [
            "📊 **Статус бота**\n",
            f"🤖 Модель: `{bot_config.DEFAULT_MODEL}`",
            f"🔗 Llama-server: {LLAMA_SERVER_HOST}",
        ]
        await self.vk.send_message(user_id, "\n".join(status_lines))

    async def _handle_models_command(self, user_id: int):
        """Обрабатывает команду /models"""
        if not bot_config.MODELS:
            await self.vk.send_message(user_id, "Нет доступных моделей")
        else:
            models_text = "📋 **Доступные модели:**\n\n"
            for alias, m in bot_config.MODELS.items():
                marker = " ← текущая" if alias == bot_config.DEFAULT_MODEL else ""
                models_text += f"• {alias}{marker}\n"
            await self.vk.send_message(user_id, models_text)

    async def _handle_history_command(self, user_id: int, text: str):
        """Обрабатывает команду /history"""
        parts = text.strip().split()
        session_id = (
            parts[1]
            if len(parts) > 1
            else await self.session_mgr.get_or_create(user_id)
        )
        await self._send_history(user_id, session_id)

    async def _send_history(self, user_id: int, session_id: str):
        """Отправляет историю сессии"""
        logger.info(f"Sending history for session {session_id} to user {user_id}")
        try:
            messages = await self.opencode_client.get_session_messages(
                session_id, limit=50
            )
            if not messages:
                await self.vk.send_message(user_id, "❌ Не удалось получить историю")
                return

            history_file = SCRIPT_DIR / f"history_{user_id}_{int(time.time())}.json"
            with open(history_file, "w", encoding="utf-8") as f:
                json.dump(messages, f, ensure_ascii=False, indent=2)

            await self.vk.send_message(
                user_id, f"📜 Отправляю историю сессии ({len(messages)} сообщений)..."
            )
            await self.vk.send_file(
                user_id,
                str(history_file),
                f"history_{user_id}.json",
                f"📜 История сессии ({len(messages)} сообщений)",
            )
            history_file.unlink(missing_ok=True)
        except Exception as e:
            logger.exception(f"Error sending history: {e}")
            await self.vk.send_message(user_id, f"❌ Ошибка отправки истории: {e}")

    async def _handle_new_session_command(self, user_id: int, text: str = ""):
        """Обрабатывает команду /newsession [workdir] или /n [workdir]

        Без аргументов создаёт новую сессию с дефолтной рабочей директорией.
        С аргументом — создаёт сессию с указанной директорией.
        """
        text = text.strip()
        workdir = None
        if text:
            workdir_path = Path(text).expanduser()
            if workdir_path.exists():
                workdir = workdir_path
                logger.info(f"/newsession: workdir argument = {workdir}")
            else:
                logger.warning(f"/newsession: workdir not found: {workdir_path}")
                await self.vk.send_message(user_id, f"❌ Директория не найдена: {workdir_path}")
        else:
            # Без аргументов — используем текущую рабочую директорию процесса
            workdir = getCwd()
            logger.info(f"/newsession: no workdir specified, using cwd: {workdir}")
        await self._new_session(user_id, workdir=workdir)

    async def _new_session(self, user_id: int, workdir: Path = None):
        """Создает новую сессию с возможностью смены рабочей директории.

        Args:
            user_id: ID пользователя
            workdir: Новая рабочая директория для opencode serve (опционально)
        """
        logger.info(f"Creating new session for user {user_id}" + (f" with workdir={workdir}" if workdir else ""))

        # Останавливаем поллеры текущего пользователя
        await self._stop_user_poller(user_id)

        # Удаляем старую сессию пользователя (если есть)
        old_session_id = self.session_mgr.sessions.get(user_id)
        if old_session_id:
            self.session_mgr.remove_session(user_id)
            logger.info(f"Removed old session {old_session_id} for user {user_id}")

        # Очищаем временные данные ТОЛЬКО текущего пользователя
        # Важно: не очищаем данные других пользователей!
        # pending_permissions: (session_id, user_id, msg_id)
        for perm_id in list(self.pending_permissions.keys()):
            session_id, perm_user_id, _ = self.pending_permissions[perm_id]
            if perm_user_id == user_id:
                del self.pending_permissions[perm_id]

        # seen_permissions и seen_questions хранятся по session_id, не по user_id
        # Их не трогаем — они относятся к конкретным сессиям, а не к пользователям
        # При удалении сессии через _stop_user_poller поллер остановится корректно

        # Очищаем parent_child_map для старой сессии пользователя
        if old_session_id and old_session_id in self.parent_child_map:
            for child_id in list(self.parent_child_map[old_session_id].keys()):
                self.session_mgr.remove_child_session(child_id)
            del self.parent_child_map[old_session_id]

        # Если указана рабочая директория — перезапускаем opencode serve
        # (если это не дефолтная директория, всё равно перезапускаем для чистоты)
        if workdir:
            if workdir == getCwd():
                # Дефолтная директория — перезапускаем только если opencode запущен с другой директорией
                current_opencode_workdir = getattr(self.opencode_process, "workdir", None)
                if current_opencode_workdir and current_opencode_workdir != workdir:
                    logger.info(f"Opencode running in different dir ({current_opencode_workdir}), restarting with {workdir}")
                    await self.vk.send_message(
                        user_id,
                        f"🔄 Перезапуск opencode serve с рабочей директорией: {workdir}",
                    )
                    await self.opencode_process.restart(workdir=workdir)
                else:
                    logger.info(f"Using default workdir: {workdir}")
            else:
                await self.vk.send_message(
                    user_id,
                    f"🔄 Перезапуск opencode serve с рабочей директорией: {workdir}",
                )
                logger.info(f"Restarting opencode serve with new workdir: {workdir}")
                await self.opencode_process.restart(workdir=workdir)

        # Создаем новую сессию через API
        new_session_id = await self.opencode_client.create_session()

        self.session_mgr.sessions[user_id] = new_session_id
        if new_session_id not in self.session_mgr.seen_messages:
            self.session_mgr.seen_messages[new_session_id] = set()
        if new_session_id not in self.session_mgr.grant_mode:
            self.session_mgr.grant_mode[new_session_id] = False

        # Сохраняем рабочую директорию для новой сессии
        if workdir:
            self.session_mgr.set_session_workdir(new_session_id, workdir)

        self.session_mgr._save()

        await self._start_session_poller(user_id, new_session_id)

        workdir_info = f"\nРабочая директория: {workdir}" if workdir else ""
        await self.vk.send_message(
            user_id,
            f"✅ Новая сессия создана: {new_session_id}\n"
            f"Старая сессия удалена.{workdir_info}",
        )

    async def _handle_sessions_command(self, user_id: int):
        """Обрабатывает команду /sessions"""
        sessions_text = ""
        for uid, sid in self.session_mgr.sessions.items():
            marker = "← вы" if uid == user_id else ""
            sessions_text += f"• `{sid}` (user={uid}) {marker}\n"
        await self.vk.send_message(user_id, f"📋 **Список сессий**:\n\n{sessions_text}")

    async def _handle_logs_command(self, user_id: int):
        """Обрабатывает команду /logs"""
        await self.vk.send_file(
            user_id, str(SCRIPT_DIR / "debug.log"), "debug.log", "📋 Логи"
        )

    async def _handle_gpu_command(self, user_id: int):
        """Обрабатывает команду /gpu"""
        message, error = await get_gpu_info_vk_message(timeout=30)
        if message:
            await self.vk.send_message(user_id, message)
        else:
            await self.vk.send_message(user_id, error)

    async def _handle_clean_attaches_command(self, user_id: int):
        """Обрабатывает команду /clean_attaches - очищает папку с аттачами"""
        import shutil

        if not ATTACHES_DIR.exists():
            await self.vk.send_message(user_id, "📁 Attaches folder does not exist")
            return

        # Подсчитываем файлы перед удалением
        files = list(ATTACHES_DIR.iterdir())
        file_count = len(files)

        if file_count == 0:
            await self.vk.send_message(user_id, "📁 Attaches folder is already empty")
            return

        # Удаляем все файлы
        for f in files:
            try:
                if f.is_file():
                    f.unlink()
                elif f.is_dir():
                    shutil.rmtree(f)
            except Exception as e:
                logger.warning(f"Failed to delete {f}: {e}")

        await self.vk.send_message(
            user_id, f"🗑️ Cleaned {file_count} file(s) from attaches folder"
        )

    async def _handle_grant_command(self, user_id: int, cmd: str):
        """Обрабатывает команду /grant - автоматическое предоставление всех разрешений"""
        parts = cmd.split(None, 1)
        if len(parts) < 2:
            session_id = self.user_session.get(user_id)
            if session_id:
                state = "ON" if self.session_mgr.get_grant_mode(session_id) else "OFF"
                await self.vk.send_message(
                    user_id,
                    f"🔓 Режим авто-разрешений: **{state}**\n\nИспользование:\n`/grant true` — разрешить всё автоматически (постоянно)\n`/grant false` — запросить разрешения вручную",
                    keyboard=vk_keyboards.get_main_keyboard(),
                )
            else:
                await self.vk.send_message(
                    user_id, "⚠️ Нет активной сессии",
                    keyboard=vk_keyboards.get_main_keyboard(),
                )
            return

        value = parts[1].strip().lower()
        if value not in ("true", "false"):
            await self.vk.send_message(
                user_id, "⚠️ Используете: `/grant true` или `/grant false`",
                keyboard=vk_keyboards.get_main_keyboard(),
            )
            return

        session_id = self.user_session.get(user_id)
        if not session_id:
            session_id = await self.session_mgr.get_or_create(user_id)
            if user_id not in self.user_session:
                self.user_session[user_id] = session_id

        self.session_mgr.set_grant_mode(session_id, value == "true")

        action = "🔓 Включён" if value == "true" else "🔒 Выключен"
        await self.vk.send_message(
            user_id,
            f"{action} режим постоянных разрешений.\nПри включении все запросы разрешений будут автоматически одобрены.",
            keyboard=vk_keyboards.get_main_keyboard(),
        )

    async def _handle_config_command(self, user_id: int, cmd: str):
        """Обрабатывает команду /config <name> - переключение конфига бота."""
        parts = cmd.split(None, 1)
        if len(parts) < 2 or not parts[1].strip():
            await self.vk.send_message(
                user_id,
                "❌ Укажите имя конфига.\n\n"
                "Пример: `/config server2` загрузит `config.server2.json`\n"
                "Или полный путь: `/config /home/user/config.custom.json`",
                keyboard=vk_keyboards.get_main_keyboard(),
            )
            return

        config_name = parts[1].strip()
        
        # Проверяем, что файл существует
        config_path = SCRIPT_DIR / f"config.{config_name}.json"
        if not config_path.exists():
            config_path = Path(config_name)
            if not config_path.exists() or config_path.suffix != ".json":
                await self.vk.send_message(
                    user_id, f"❌ Конфиг не найден: {config_name}",
                    keyboard=vk_keyboards.get_main_keyboard(),
                )
                return

        await self.vk.send_message(user_id, f"🔄 Загружаю конфиг: {config_path.name}...")

        # Переключаем конфиг
        import config
        if not config.switch_config(str(config_path)):
            await self.vk.send_message(
                user_id, "❌ Ошибка загрузки конфига",
                keyboard=vk_keyboards.get_main_keyboard(),
            )
            return

        # switch_config уже обновил все глобалы config-модуля.
        # Пересоздаём клиента OpenCode с новым URL из конфига
        await self.opencode_client.__aexit__(None, None, None)
        self.opencode_client = OpenCodeClient()
        await self.opencode_client.__aenter__()

        # Рестартуем opencode serve с новой моделью (CLI аргументы)
        try:
            await self.opencode_process.restart(model=config.CLI_MODEL, provider_url=config.PROVIDER_URL)
        except Exception as e:
            logger.warning(f"Failed to restart opencode after config switch: {e}")

        # После смены конфига пересоздаём ВСЕ сессии с новой моделью,
        # сохраняя их рабочие директории
        old_sessions = dict(self.session_mgr.sessions)  # копируем, чтобы не менять во время итерации
        my_new_sid = None
        for uid, old_sid in old_sessions.items():
            saved_wd = self.session_mgr.get_session_workdir(old_sid)
            if not saved_wd:
                saved_wd = getattr(self.opencode_process, "workdir", None)

            await self._stop_user_poller(uid)
            self.session_mgr.remove_session(uid)

            new_sid = await self.opencode_client.create_session()
            self.session_mgr.sessions[uid] = new_sid
            if new_sid not in self.session_mgr.seen_messages:
                self.session_mgr.seen_messages[new_sid] = set()
            if new_sid not in self.session_mgr.grant_mode:
                self.session_mgr.grant_mode[new_sid] = False
            if saved_wd:
                self.session_mgr.set_session_workdir(new_sid, saved_wd)

            if uid == user_id:
                my_new_sid = new_sid

        self.session_mgr._save()

        if my_new_sid:
            await self._start_session_poller(user_id, my_new_sid)

        await self.vk.send_message(
            user_id,
            f"✅ Конфиг `{config_path.name}` загружен\n"
            f"📋 Модель: `{config.DEFAULT_MODEL}`\n"
            f"🔗 Сервер: {config.LLAMA_SERVER_HOST}\n"
            f"🔄 Сессия обновлена: {my_new_sid or '?'}",
            keyboard=vk_keyboards.get_main_keyboard(),
        )

    async def _handle_test_llama_command(self, user_id: int, cmd: str):
        """Обрабатывает команду /test-llama - тест скорости инференса llama-server"""
        # Определяем URL для теста
        # Если есть аргумент - используем его, иначе URL из конфига
        parts = cmd.split(None, 1)
        if len(parts) > 1 and parts[1].startswith("http"):
            llama_url = parts[1].rstrip("/")
        else:
            llama_url = LLAMA_SERVER_HOST.rstrip("/")
        
        # Берём текущую модель для отправки в запросе (реальное имя модели)
        current_model = get_current_model()
        model_name = current_model.get("model") if current_model else None
        
        await self.vk.send_message(user_id, "🔍 Тестирование llama-server...")
        
        speed, error = await test_llama_server_speed(llama_url, model_name)
        
        if error:
            await self.vk.send_message(user_id, error, keyboard=vk_keyboards.get_main_keyboard())
        else:
            await self.vk.send_message(user_id, speed, keyboard=vk_keyboards.get_main_keyboard())

    async def _send_help(self, user_id: int):
        """Отправляет справку"""
        help_text = """
🤖 **OpenCode VK Gateway - Команды**

/history - Получить историю сессии файлом
/history <session_id> - Получить историю конкретной сессии
/gpu - Показать информацию о GPU (nvidia-smi)
/logs - Отправить файл логов
/sessions - Показать список всех сессий
/newsession [path] - Создать новую сессию (очищает старые)
/n [path] - То же что /newsession
/newsession /path/to/project - Смена рабочей директории opencode serve
/models - Показать доступные модели
/m - То же что /models
/clean_attaches - Очистить папку с аттачами
/grant [true|false] - Авто-разрешение всех запросов (once)
/config &lt;name&gt; - Загрузить конфиг config.&lt;name&gt;.json
/help - Показать эту справку
/restart - Перезапустить с текущей моделью
/restart <model> - Перезапустить с указанной моделью
/r <model> - То же что /restart <model>

Все остальные сообщения отправляются в opencode для обработки.
"""
        await self.vk.send_message(user_id, help_text)

    # ---------- Основной цикл ----------
    async def run(self):
        """Запускает long poll для получения новых сообщений"""
        self.running = True

        # Инициализируем HTTP клиент для OpenCode
        self.opencode_client = OpenCodeClient()
        await self.opencode_client.__aenter__()

        try:
            await self._refresh_long_poll_server_with_retry()

            while self.running:
                try:
                    updates, new_ts, failed_code = await self._get_long_poll_events()

                    if failed_code is not None:
                        # failed: 1 - история устарела, нужен новый ts
                        # failed: 2 - ключ истёк
                        # failed: 3 - информация потеряна
                        logger.debug(
                            f"Long poll key expired (failed={failed_code}), refreshing..."
                        )
                        await self._refresh_long_poll_server_with_retry()
                        continue

                    self.ts = new_ts

                    for update in updates:
                        if isinstance(update, list) and update[0] == 4:
                            _create_task_with_handler(
                                self._handle_message_new(update),
                                task_name="handle_message_new"
                            )

                except asyncio.CancelledError:
                    break
                except (asyncio.TimeoutError, aiohttp.ClientError) as e:
                    logger.warning(f"Long poll error: {e}. Reconnecting in 30 seconds...")
                    await self._refresh_long_poll_server_with_retry()
                except Exception as e:
                    logger.exception(f"Long poll error: {e}")
                    await self._refresh_long_poll_server_with_retry()
        finally:
            await self.opencode_client.__aexit__(None, None, None)

    async def stop(self):
        """Останавливает все поллеры"""
        self.running = False
        for session_id in list(self.session_pollers.keys()):
            await self._stop_session_poller(session_id)
