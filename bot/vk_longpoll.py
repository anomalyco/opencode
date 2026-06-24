"""
VK event handler — listens for VK messages via Long Poll
and OpenCode events via SSE.
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
    ALLOWED_FOLDERS,
    ATTACHES_DIR,
    LLAMA_SERVER_HOST,
    LONGPOLL_WAIT,
    OPENCODE_URL,
    SCRIPT_DIR,
    SHUTDOWN_SCRIPT,
    SUBAGENT_PREFIX,
    THINKING_PEER_ID,
    getCwd,
)
from llama_server import do_restart, test_llama_server_speed
from logging_config import logger
from models import get_current_model
from nvidia import get_gpu_info_vk_message
from opencode_client import OpenCodeClient
from opencode_process import OpenCodeProcess
from session_manager import SessionManager
from sse_listener import SSEEventListener as SSEListener
from vk_client import VKClient


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


def _format_mib(mib: float) -> str:
    """Форматирует MiB в читаемый формат (GiB/MiB/KiB) с округлением"""
    mib = float(mib)
    if mib >= 1024:
        return f"{mib / 1024:.1f}GiB"
    elif mib >= 1:
        return f"{mib:.0f}MiB"
    else:
        return f"{mib * 1024:.0f}KiB"


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

        # SSE слушатель событий OpenCode
        self.sse_listener: Optional[SSEListener] = None

        # session_id -> user_id для маршрутизации SSE событий
        self.session_to_user: Dict[str, int] = {}  # session_id -> user_id

        # Child session (subagent/subtask) tracking
        self.parent_child_map: Dict[str, Dict[str, dict]] = {}  # parent_id -> {child_id: {title, ...}}

        # Временные хранилища
        self.waiting_for_answer: Dict = {}  # user_id -> question_id или (peer_id, child_id) -> question_id
        self.pending_permissions: Dict[str, Tuple[str, int, int]] = {}
        self.seen_permissions: Dict[str, set] = {}
        self.seen_questions: Dict[str, set] = {}

    # ---------- SSE callbacks ----------

    def _register_sse_callbacks(self):
        """Регистрирует SSE колбэки для обработки событий OpenCode"""
        self.sse_listener.on("session.next.text.ended", self._on_text_ended)
        self.sse_listener.on("session.next.reasoning.ended", self._on_reasoning_ended)
        self.sse_listener.on("session.next.tool.called", self._on_tool_event)
        self.sse_listener.on("session.next.tool.success", self._on_tool_event)
        self.sse_listener.on("session.next.tool.failed", self._on_tool_event)
        self.sse_listener.on("session.next.step.started", self._on_step_event)
        self.sse_listener.on("session.next.step.ended", self._on_step_event)
        self.sse_listener.on("session.next.step.failed", self._on_step_event)
        self.sse_listener.on("permission.asked", self._on_permission)
        self.sse_listener.on("permission.v2.asked", self._on_permission)  # v2 API fallback
        self.sse_listener.on("question.asked", self._on_question)
        self.sse_listener.on("question.v2.asked", self._on_question)  # v2 API fallback
        self.sse_listener.on("session.created", self._on_session_created)
        self.sse_listener.on("session.idle", self._on_session_idle)
        self.sse_listener.on("session.status", self._on_session_status)
        self.sse_listener.on("todo.updated", self._on_todo_updated)
        self.sse_listener.on_any(self._on_any_event)

    async def _on_text_ended(self, event_type: str, data: dict):
        """Обрабатывает завершение текстового ответа"""
        session_id = data.get("sessionID", "")
        user_id = self.session_to_user.get(session_id)
        if not user_id:
            return
        text = data.get("text", "")
        if not text.strip():
            return
        await self.vk.send_message(user_id, text)

    async def _on_reasoning_ended(self, event_type: str, data: dict):
        """Обрабатывает завершение рассуждения"""
        session_id = data.get("sessionID", "")
        user_id = self.session_to_user.get(session_id)
        if not user_id:
            return
        text = data.get("text", "")
        if not text.strip():
            return
        target = THINKING_PEER_ID if THINKING_PEER_ID else user_id
        await self.vk.send_message(target, f"🧠:\n{text}")

    async def _on_tool_event(self, event_type: str, data: dict):
        """Обрабатывает события инструментов с детальным описанием"""
        session_id = data.get("sessionID", "")
        user_id = self.session_to_user.get(session_id)
        if not user_id:
            return

        tool_name = data.get("tool", "") or data.get("name", "")
        target = THINKING_PEER_ID if THINKING_PEER_ID else user_id
        action = event_type.split(".")[-1] if "." in event_type else "event"

        if action == "called":
            tool_input = data.get("input", {})
            if isinstance(tool_input, dict):
                # Показываем ключевые параметры (не весь JSON чтобы не спамить)
                keys = list(tool_input.keys())[:5]
                params = ", ".join(f"{k}={repr(tool_input[k])[:50]}" for k in keys)
                desc = f"({params})" if params else ""
            else:
                desc = ""
            await self.vk.send_message(target, f"🔧 Вызов: {tool_name}{desc}")

        elif action == "success":
            result = data.get("structured", data.get("result", {}))
            if isinstance(result, dict):
                keys = list(result.keys())[:3]
                preview = ", ".join(f"{k}" for k in keys)
                desc = f" → [{preview}]" if preview else ""
            else:
                desc = ""
            await self.vk.send_message(target, f"🔧 Готово: {tool_name}{desc}")

        elif action == "failed":
            error = data.get("error", {})
            msg = error.get("message", "?") if isinstance(error, dict) else str(error)
            await self.vk.send_message(target, f"❌ Ошибка: {tool_name} — {msg}")

        else:
            await self.vk.send_message(target, f"🔧 Tool {tool_name} ({action})")

    async def _on_step_event(self, event_type: str, data: dict):
        """Обрабатывает события шагов с детальным описанием"""
        session_id = data.get("sessionID", "")
        user_id = self.session_to_user.get(session_id)
        if not user_id:
            return

        step_type = event_type.split(".")[-1] if "." in event_type else "step"
        target = THINKING_PEER_ID if THINKING_PEER_ID else user_id

        if step_type == "started":
            agent = data.get("agent", "?")
            model = data.get("model", {})
            model_id = model.get("id", "?") if isinstance(model, dict) else str(model)
            await self.vk.send_message(target, f"🧠: Шаг начат — агент={agent}, модель={model_id}")

        elif step_type == "ended":
            finish = data.get("finish", "?")
            tokens = data.get("tokens", {})
            input_tok = tokens.get("input", 0)
            output_tok = tokens.get("output", 0)
            await self.vk.send_message(
                target,
                f"🧠: Шаг завершён — причина={finish}, токены in={input_tok} out={output_tok}",
            )

        elif step_type == "failed":
            error = data.get("error", {})
            msg = error.get("message", "?") if isinstance(error, dict) else str(error)
            await self.vk.send_message(target, f"❌: Шаг провалился — {msg}")

        else:
            await self.vk.send_message(target, f"🧠: Step {step_type}")

    async def _on_permission(self, event_type: str, data: dict):
        """Обрабатывает запрос разрешения через SSE"""
        session_id = data.get("sessionID", "")
        user_id = self.session_to_user.get(session_id)
        if not user_id:
            return
        perm = data
        perm_id = perm.get("id") or perm.get("permissionID") or perm.get("permissionId")
        if not perm_id:
            return

        if session_id not in self.seen_permissions:
            self.seen_permissions[session_id] = set()
        if perm_id in self.seen_permissions[session_id]:
            return
        self.seen_permissions[session_id].add(perm_id)

        # Авто-аппрув для разрешённых папок из конфига (allowed_folders)
        # opencode API использует "patterns", v2 API использует "resources"
        resources = perm.get("patterns") or perm.get("resources", [])
        if self._is_allowed_folder_permission(resources):
            logger.info(f"🔓 Auto-approving allowed folder permission {perm_id}: {resources}")
            await self.opencode_client.send_permission_response(session_id, perm_id, "always")
            return

        # Проверяем grant_mode для текущей сессии или родительской
        if self._should_auto_grant(session_id):
            logger.debug(f"Auto-grant: approving permission {perm_id}")
            await self.opencode_client.send_permission_response(session_id, perm_id, "always")
            return

        msg = self._format_permission_message(perm)
        keyboard = self._create_permission_keyboard()
        msg_id = await self.vk.send_message(user_id, msg, keyboard=keyboard)
        self.pending_permissions[perm_id] = (session_id, user_id, msg_id)

    def _should_auto_grant(self, session_id: str) -> bool:
        """Проверяет, нужно ли авто-аппрув для сессии (включая родительскую)."""
        # Сначала проверяем текущую сессию
        if self.session_mgr.get_grant_mode(session_id):
            return True
        # Если это дочерняя сессия - проверяем родительскую
        parent_id = self.session_mgr.child_sessions.get(session_id)
        if parent_id and self.session_mgr.get_grant_mode(parent_id):
            return True
        return False

    def _is_allowed_folder_permission(self, patterns: list[str]) -> bool:
        """Проверяет, находятся ли все паттерны в разрешённых папках из конфига."""
        if not patterns:
            return False

        # Используем ALLOWED_FOLDERS из конфига
        allowed_folders = ALLOWED_FOLDERS or []
        if not allowed_folders:
            return False

        for pattern in patterns:
            # Обрабатываем file:// URLs
            if pattern.startswith("file://"):
                pattern = pattern[7:]
            # Убираем glob-суффиксы (*, **)
            base_path = pattern.rstrip("*").rstrip("/")
            # Проверяем, что базовый путь начинается с одной из разрешённых папок
            if not any(base_path.startswith(folder) for folder in allowed_folders):
                return False
        return True

    async def _on_question(self, event_type: str, data: dict):
        """Обрабатывает вопрос через SSE"""
        session_id = data.get("sessionID", "")
        user_id = self.session_to_user.get(session_id)
        if not user_id:
            return
        q = data
        q_id = q.get("id") or q.get("questionID") or q.get("questionId")
        if not q_id:
            return

        if session_id not in self.seen_questions:
            self.seen_questions[session_id] = set()
        if q_id in self.seen_questions[session_id]:
            return
        self.seen_questions[session_id].add(q_id)

        actual_question = q.get("questions", [{}])[0] if q.get("questions") else q
        await self._show_question(user_id, actual_question, original_id=q_id, session_id=session_id)

    async def _on_session_created(self, event_type: str, data: dict):
        """Обрабатывает создание новой сессии (в т.ч. дочерней)"""
        session_id = data.get("sessionID", "")
        info = data.get("info", {})
        parent_id = info.get("parentID") or data.get("parentID")
        if not parent_id:
            return
        parent_user = self.session_to_user.get(parent_id)
        if not parent_user:
            return
        self.session_to_user[session_id] = parent_user
        if parent_id not in self.parent_child_map:
            self.parent_child_map[parent_id] = {}
        title = info.get("title", session_id[:12])
        self.parent_child_map[parent_id][session_id] = {
            "title": title,
        }
        # Регистрируем дочернюю сессию в session_mgr для grant_mode
        self.session_mgr.register_child_session(session_id, parent_id)
        target = THINKING_PEER_ID if THINKING_PEER_ID else parent_user
        await self.vk.send_message(target, f"🚀 Subagent started: {title}")

    async def _on_session_idle(self, event_type: str, data: dict):
        """Обрабатывает завершение работы агента (session.idle)"""
        session_id = data.get("sessionID", "")
        user_id = self.session_to_user.get(session_id)
        if not user_id:
            return
        # Проверяем, является ли сессия дочерней (subagent)
        parent_id = None
        for child_id, par_id in self.session_mgr.child_sessions.items():
            if child_id == session_id:
                parent_id = par_id
                break
        if parent_id:
            # Для дочерней сессии — уведомляем в thinking_peer_id
            target = THINKING_PEER_ID if THINKING_PEER_ID else user_id
            child_info = self.parent_child_map.get(parent_id, {}).get(session_id, {})
            title = child_info.get("title", session_id[:12])
            await self.vk.send_message(target, f"✅ Subagent завершён: {title}")
        else:
            # Для основной сессии — тихо (последний text.ended уже отправил ответ)
            logger.debug(f"Session idle: {session_id}")

    async def _on_session_status(self, event_type: str, data: dict):
        """Обрабатывает изменение статуса сессии (session.status)"""
        session_id = data.get("sessionID", "")
        status = data.get("status", {})
        status_type = status.get("type", "") if isinstance(status, dict) else ""
        user_id = self.session_to_user.get(session_id)
        if not user_id:
            return
        if status_type == "error":
            error_msg = status.get("message", "Неизвестная ошибка") if isinstance(status, dict) else "Ошибка"
            target = THINKING_PEER_ID if THINKING_PEER_ID else user_id
            await self.vk.send_message(target, f"❌ Агент завершился с ошибкой: {error_msg}")
        elif status_type == "retry":
            attempt = status.get("attempt", "?") if isinstance(status, dict) else "?"
            logger.info(f"Session {session_id} retry attempt {attempt}")

    async def _on_todo_updated(self, event_type: str, data: dict):
        """Обрабатывает обновление плана/задач"""
        session_id = data.get("sessionID", "")
        user_id = self.session_to_user.get(session_id)
        if not user_id:
            return

        todos = data.get("todos", [])
        if not todos:
            return

        target = THINKING_PEER_ID if THINKING_PEER_ID else user_id

        # Формируем красивый список задач
        status_icons = {
            "pending": "⏳",
            "in_progress": "🔄",
            "completed": "✅",
            "cancelled": "❌",
        }

        lines = ["📋 **План обновлён:**"]
        for i, todo in enumerate(todos, 1):
            status = todo.get("status", "pending")
            content = todo.get("content", "?")
            icon = status_icons.get(status, "❓")
            lines.append(f"{i}. {icon} {content}")

        await self.vk.send_message(target, "\n".join(lines))

    _NOISY_EVENTS = {
        "session.next.text.delta",
        "session.next.reasoning.delta",
        "session.next.tool.input.delta",
        "file.watcher.updated",
        "plugin.added",
        "catalog.updated",
        "integration.updated",
        "reference.updated",
        "server.heartbeat",
        "message.part.delta",
    }

    async def _on_any_event(self, event_type: str, data: dict):
        """Логирует все SSE события для отладки"""
        if event_type in self._NOISY_EVENTS:
            return
        logger.debug(f"SSE event: {event_type} keys={list(data.keys()) if isinstance(data, dict) else '?'}")

    # ---------- Обработка разрешений ----------
    def _format_permission_message(self, perm: dict) -> str:
        """Форматирует сообщение для запроса разрешения."""
        # opencode API: "permission" + "patterns", v2 API: "action" + "resources"
        perm_type = perm.get("permission") or perm.get("action", "unknown")
        patterns = perm.get("patterns") or perm.get("resources", [])
        metadata = perm.get("metadata") or {}

        # Формируем краткое сообщение
        if patterns:
            patterns_str = ", ".join(f"`{p}`" for p in patterns[:3])
            if len(patterns) > 3:
                patterns_str += f" ... ({len(patterns)} total)"
            return f"⚠️ **Запрос разрешения**\n\n`{perm_type}`: {patterns_str}"

        # Fallback для bash команд
        if perm_type == "bash":
            command = metadata.get("command", metadata.get("cmd", "?"))
            return f"⚠️ **Запрос разрешения**\n\n`bash`: `{command}`"

        # Fallback - показываем тип и путь из metadata
        filepath = metadata.get("filepath", metadata.get("path", "?"))
        return f"⚠️ **Запрос разрешения**\n\n`{perm_type}`: `{filepath}`"

    def _create_permission_keyboard(self) -> dict:
        """Создает клавиатуру для ответа на разрешение"""
        return vk_keyboards.get_permission_keyboard()

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

        if cmd == "/sysmon":
            await self._handle_sysmon_command(user_id)
            return

        if cmd == "/shutdown":
            await self._handle_shutdown_command(user_id)
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

        # Регистрируем маппинг session -> user для маршрутизации SSE событий
        self.session_to_user[session_id] = user_id

        # Обрабатываем аттачи
        attachment_info = ""
        if attachments:
            for att in attachments:
                logger.debug(f"Attachment type: {att.get('type')}")
            downloaded = await self.vk.download_attachments(attachments, ATTACHES_DIR)
            if downloaded:
                attachment_info = self._format_attachment_info(downloaded)
            else:
                logger.debug(f"No attachments were downloaded (count={len(attachments)})")

        full_text = text
        if attachment_info:
            full_text = f"{text}\n\n{attachment_info}" if text else attachment_info

        success = await self.opencode_client.send_prompt(session_id, full_text)
        if not success:
            # Сессия могла исчезнуть после рестарта opencode - пересоздаём
            logger.warning(f"Failed to send prompt to {session_id}, recreating session")
            self.session_mgr.remove(user_id)
            session_id = await self.session_mgr.get_or_create(user_id)
            self.session_to_user[session_id] = user_id

            # Повторяем отправку
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
            if saved_workdir:
                self.opencode_process.workdir = saved_workdir

            # Пересоздаём aiohttp сессию после рестарта opencode
            await self.opencode_client.__aexit__(None, None, None)
            await self.opencode_client.__aenter__()
            new_session_id = await self.opencode_client.create_session()
            self.session_mgr.sessions[user_id] = new_session_id
            if new_session_id not in self.session_mgr.grant_mode:
                self.session_mgr.grant_mode[new_session_id] = False
            if saved_workdir:
                self.session_mgr.set_session_workdir(new_session_id, saved_workdir)
            self.session_mgr._save()

            if old_session_id and old_session_id in self.session_to_user:
                del self.session_to_user[old_session_id]
            self.session_to_user[new_session_id] = user_id

            await self.vk.send_message(user_id, f"✅ Модель {model_info} загружена")

    async def _handle_status_command(self, user_id: int):
        """Обрабатывает команду /status - показывает текущий статус бота"""
        status_lines = [
            "📊 **Статус бота**\n",
            f"🤖 Модель: `{bot_config.DEFAULT_MODEL}`",
            f"🔗 Llama-server: {LLAMA_SERVER_HOST}",
        ]

        # Добавляем sysmon данные если настроено
        sysmon_data = await self._get_sysmon_data()
        if sysmon_data:
            status_lines.append("")
            status_lines.extend(sysmon_data)

        await self.vk.send_message(user_id, "\n".join(status_lines))

    async def _get_sysmon_data(self) -> list:
        """Получает sysmon данные, возвращает список строк для вывода или None"""
        import config

        sysmon_url = config.CONFIG.get("sysmon", "").strip()
        if not sysmon_url:
            return None

        try:
            async with aiohttp.ClientSession(timeout=ClientTimeout(total=5)) as session:
                async with session.get(f"http://{sysmon_url}") as resp:
                    if resp.status != 200:
                        return None
                    data = await resp.json()

            lines = []

            # GPU информация
            if "gpu" in data:
                gpu = data["gpu"]
                load = gpu.get("load_percent", 0)
                vram_used = gpu.get("vram_used_mib", 0)
                vram_total = gpu.get("vram_total_mib", 0)
                gtt_used = gpu.get("gtt_used_mib", 0)
                gtt_total = gpu.get("gtt_total_mib", 0)

                lines.append(f"🔧 GPU: {load}%")
                lines.append(f"   VRAM: {_format_mib(vram_used)} / {_format_mib(vram_total)}")
                lines.append(f"   GTT: {_format_mib(gtt_used)} / {_format_mib(gtt_total)}")

            # Топ процесс
            if "processes" in data and data["processes"]:
                top_proc = data["processes"][0]
                mem_bytes = top_proc.get("memory_bytes", 0)
                mem_pct = top_proc.get("mem_pct", "0")
                lines.append(f"📈 Top: {_format_mib(mem_bytes // 1024 // 1024)} ({mem_pct}%)")

            return lines
        except (asyncio.TimeoutError, aiohttp.ClientError, Exception):
            return None

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

        old_session_id = self.session_mgr.sessions.get(user_id)
        if old_session_id:
            if old_session_id in self.session_to_user:
                del self.session_to_user[old_session_id]
            self.session_mgr.remove_session(user_id)
            logger.info(f"Removed old session {old_session_id} for user {user_id}")

        # Очищаем временные данные ТОЛЬКО текущего пользователя
        for perm_id in list(self.pending_permissions.keys()):
            session_id, perm_user_id, _ = self.pending_permissions[perm_id]
            if perm_user_id == user_id:
                del self.pending_permissions[perm_id]

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
        logger.info("Creating new session via API...")
        try:
            # Даём серверу время на полную инициализацию после рестарта
            await asyncio.sleep(2)
            # Пересоздаём aiohttp сессию после рестарта opencode
            await self.opencode_client.__aexit__(None, None, None)
            await self.opencode_client.__aenter__()
            new_session_id = await self.opencode_client.create_session()
            logger.info(f"New session created: {new_session_id}")
        except Exception as e:
            logger.exception(f"Failed to create session: {e}")
            await self.vk.send_message(user_id, f"❌ Ошибка создания сессии: {e}")
            return

        self.session_mgr.sessions[user_id] = new_session_id
        if new_session_id not in self.session_mgr.grant_mode:
            self.session_mgr.grant_mode[new_session_id] = False

        if workdir:
            self.session_mgr.set_session_workdir(new_session_id, workdir)

        self.session_mgr._save()

        self.session_to_user[new_session_id] = user_id

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

    async def _handle_shutdown_command(self, user_id: int):
        """Обрабатывает команду /shutdown"""
        if not SHUTDOWN_SCRIPT:
            await self.vk.send_message(user_id, "❌ shutdown не определен в конфиге")
            return

        await self.vk.send_message(user_id, "shutdown pc...")
        process = await asyncio.create_subprocess_exec(
            "sudo", SHUTDOWN_SCRIPT,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        await asyncio.wait_for(process.communicate(), timeout=30)

    async def _handle_sysmon_command(self, user_id: int):
        """Обрабатывает команду /sysmon - показывает статус системы через sysmon сервер"""
        import config

        sysmon_url = config.CONFIG.get("sysmon", "").strip()
        if not sysmon_url:
            await self.vk.send_message(user_id, "❌ Sysmon URL не настроен в config.json")
            return

        try:
            async with aiohttp.ClientSession(timeout=ClientTimeout(total=10)) as session:
                async with session.get(f"http://{sysmon_url}") as resp:
                    if resp.status != 200:
                        await self.vk.send_message(user_id, f"❌ Sysmon вернул статус {resp.status}")
                        return
                    data = await resp.json()

            # Форматируем вывод
            lines = ["🖥️ **Системный монитор**", ""]

            # GPU информация
            if "gpu" in data:
                gpu = data["gpu"]
                load = gpu.get("load_percent", 0)
                vram_used = gpu.get("vram_used_mib", 0)
                vram_total = gpu.get("vram_total_mib", 0)
                gtt_used = gpu.get("gtt_used_mib", 0)
                gtt_total = gpu.get("gtt_total_mib", 0)

                lines.append(f"🔧 **GPU**: {load}%")
                lines.append(f"   VRAM: {_format_mib(vram_used)} / {_format_mib(vram_total)}")
                lines.append(f"   GTT: {_format_mib(gtt_used)} / {_format_mib(gtt_total)}")
                lines.append("")

            # Топ процессов
            if "processes" in data and data["processes"]:
                lines.append("**📊 Топ процессов по памяти:**")
                for i, proc in enumerate(data["processes"][:5], 1):
                    mem_bytes = proc.get("memory_bytes", 0)
                    mem_pct = proc.get("mem_pct", "0")
                    cmd = proc.get("command", "")
                    # Обрезаем длинные команды
                    if len(cmd) > 60:
                        cmd = cmd[:57] + "..."
                    lines.append(f"{i}. {_format_mib(mem_bytes // 1024 // 1024)} ({mem_pct}%) - {cmd}")

            await self.vk.send_message(user_id, "\n".join(lines))
        except asyncio.TimeoutError:
            await self.vk.send_message(user_id, "❌ Таймаут подключения к sysmon")
        except aiohttp.ClientError as e:
            await self.vk.send_message(user_id, f"❌ Ошибка подключения: {e}")
        except Exception as e:
            logger.exception(f"Error in /sysmon: {e}")
            await self.vk.send_message(user_id, f"❌ Ошибка: {e}")

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
            session_id = self.session_mgr.sessions.get(user_id)
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

        session_id = self.session_mgr.sessions.get(user_id)
        if not session_id:
            session_id = await self.session_mgr.get_or_create(user_id)

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
        old_sessions = dict(self.session_mgr.sessions)
        my_new_sid = None
        for uid, old_sid in old_sessions.items():
            saved_wd = self.session_mgr.get_session_workdir(old_sid)
            if not saved_wd:
                saved_wd = getattr(self.opencode_process, "workdir", None)

            if old_sid in self.session_to_user:
                del self.session_to_user[old_sid]
            self.session_mgr.remove_session(uid)

            new_sid = await self.opencode_client.create_session()
            self.session_mgr.sessions[uid] = new_sid
            if new_sid not in self.session_mgr.grant_mode:
                self.session_mgr.grant_mode[new_sid] = False
            if saved_wd:
                self.session_mgr.set_session_workdir(new_sid, saved_wd)

            self.session_to_user[new_sid] = uid
            if uid == user_id:
                my_new_sid = new_sid

        self.session_mgr._save()

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
/sysmon - Показать статус системы (GPU, RAM, процессы)
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
        """Запускает VK Long Poll и SSE слушатель OpenCode"""
        self.running = True

        self.opencode_client = OpenCodeClient()
        await self.opencode_client.__aenter__()

        self.sse_listener = SSEListener(OPENCODE_URL)
        self._register_sse_callbacks()
        await self.sse_listener.start()

        try:
            await self._refresh_long_poll_server_with_retry()

            while self.running:
                try:
                    updates, new_ts, failed_code = await self._get_long_poll_events()

                    if failed_code is not None:
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
            await self.sse_listener.stop()
            await self.opencode_client.__aexit__(None, None, None)

    async def stop(self):
        """Останавливает VK Long Poll и SSE слушатель"""
        self.running = False
        if self.sse_listener:
            await self.sse_listener.stop()
