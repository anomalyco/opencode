"""
VK Client - обёртка для VK API
Использует POST для отправки сообщений (избегает 414 при длинных текстах),
GET для получения данных. Поддерживает клавиатуры, файлы и вопросные клавиатуры.
"""

import json
import logging
import time
from datetime import datetime
from pathlib import Path
from typing import List, Optional, Tuple
from urllib.parse import urlencode

import asyncio
from aiohttp import ClientSession, ClientTimeout, FormData

logger = logging.getLogger("vk-opencode")

# Константы для retry при флуд-контроле
MAX_RETRIES = 3
INITIAL_RETRY_DELAY = 0.5  # секунды


class VKClient:
    BASE_URL = "https://api.vk.com/method/"

    def __init__(self, token: str, api_version: str = "5.200"):
        self.token = token
        self.api_version = api_version
        self.session: Optional[ClientSession] = None

    async def __aenter__(self):
        self.session = ClientSession(timeout=ClientTimeout(total=30))
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.session:
            await self.session.close()

    async def _api_request(self, method: str, params: dict) -> dict:
        """Базовый GET-запрос к VK API (используется для получения данных)."""
        params["access_token"] = self.token
        params["v"] = self.api_version
        url = f"{self.BASE_URL}{method}?{urlencode(params)}"
        try:
            async with self.session.get(url) as resp:
                data = await resp.json()
                if "error" in data:
                    raise Exception(f"VK API error: {data['error']}")
                return data["response"]
        except (aiohttp.ClientError, asyncio.TimeoutError) as e:
            logger.error(f"VK API request failed ({method}): {e}")
            raise

    async def get_long_poll_server(self) -> Tuple[str, str, int]:
        resp = await self._api_request("messages.getLongPollServer", {})
        return resp["server"], resp["key"], int(resp["ts"])

    async def get_messages_by_ids(self, msg_ids: List[int]) -> List[dict]:
        ids_str = ",".join(str(i) for i in msg_ids)
        resp = await self._api_request("messages.getById", {"message_ids": ids_str})
        return resp.get("items", [])

    async def send_message(
        self,
        peer_id: int,
        text: str = "",
        attachment: str = "",
        keyboard: Optional[dict] = None,
        max_length: int = 2000,
    ) -> int:
        """
        Отправка сообщения методом POST.
        Автоматически дробит длинные сообщения на части (порог: max_length символов).
        """
        if not text:
            return await self._send_single_message(peer_id, "", attachment, keyboard)

        if len(text) <= max_length:
            return await self._send_single_message(peer_id, text, attachment, keyboard)

        # Дробим длинное сообщение
        parts = self._split_text(text, max_length)
        last_msg_id = 0

        for i, part in enumerate(parts):
            # Добавляем нумерацию частей
            part_text = f"[{i + 1}/{len(parts)}]\n{part}"
            last_msg_id = await self._send_single_message(
                peer_id, part_text, attachment if i == 0 else "", keyboard if i == 0 else None
            )
            # Небольшая пауза между сообщениями
            if i < len(parts) - 1:
                await asyncio.sleep(0.3)

        return last_msg_id

    async def _send_single_message(
        self,
        peer_id: int,
        text: str = "",
        attachment: str = "",
        keyboard: Optional[dict] = None,
    ) -> int:
        """Отправка одного сообщения с retry при флуд-контроле."""
        payload = {
            "peer_id": peer_id,
            "random_id": int(time.time() * 1000),
            "v": self.api_version,
            "access_token": self.token,
        }
        if text:
            payload["message"] = text
        if attachment:
            payload["attachment"] = attachment
        if keyboard:
            payload["keyboard"] = json.dumps(keyboard)

        url = f"{self.BASE_URL}messages.send"

        # Retry с экспоненциальной задержкой при флуд-контроле
        for attempt in range(MAX_RETRIES):
            async with self.session.post(url, data=payload) as resp:
                data = await resp.json()
                if "error" in data:
                    error = data["error"]
                    error_code = error.get("error_code")
                    error_msg = error.get("error_msg", "")

                    # Проверяем на флуд-контроль (ошибка 9 или текст содержит "Flood control")
                    is_flood = (
                        error_code == 9 or
                        "Flood control" in error_msg or
                        "too much messages" in error_msg.lower()
                    )

                    if is_flood and attempt < MAX_RETRIES - 1:
                        delay = INITIAL_RETRY_DELAY * (2 ** attempt)
                        logger.warning(
                            f"Flood control detected, retry {attempt + 1}/{MAX_RETRIES} "
                            f"after {delay:.1f}s"
                        )
                        await asyncio.sleep(delay)
                        continue

                    raise Exception(f"VK API error: {error}")

                resp_data = data["response"]
                return (
                    resp_data[0]["message_id"] if isinstance(resp_data, list) else resp_data
                )

    def _split_text(self, text: str, max_length: int) -> List[str]:
        """Разбивает текст на части по строкам, не превышая max_length."""
        # Резервируем место для нумерации [N/M]\n
        safe_length = max_length - 20

        parts = []
        current_part = ""
        lines = text.split("\n")

        for line in lines:
            # Если одна строка слишком длинная, разбиваем её
            if len(line) > safe_length:
                if current_part:
                    parts.append(current_part)
                    current_part = ""
                # Разбиваем длинную строку на куски
                for i in range(0, len(line), safe_length):
                    parts.append(line[i:i + safe_length])
            elif len(current_part) + len(line) + 1 > safe_length:
                # Текущая часть заполнена, начинаем новую
                parts.append(current_part)
                current_part = line
            else:
                if current_part:
                    current_part += "\n" + line
                else:
                    current_part = line

        if current_part:
            parts.append(current_part)

        return parts

    async def send_question_keyboard(
        self, peer_id: int, header: str, question_text: str, options: List[dict]
    ):
        """Отправка inline-клавиатуры для вопросов (каждая опция – кнопка с текстом)."""
        buttons = []
        for opt in options:
            buttons.append(
                [
                    {
                        "action": {
                            "type": "text",
                            "label": opt["label"],
                        },
                        "color": "primary",
                    }
                ]
            )
        keyboard = {"inline": False, "buttons": buttons}
        text = f"🔧 {header}\n\n{question_text}"
        await self.send_message(peer_id, text, keyboard=keyboard)

    async def send_keyboard(self, peer_id: int, text: str, buttons: list):
        """Отправить произвольную клавиатуру."""
        keyboard = {"inline": False, "buttons": buttons}
        await self.send_message(peer_id, text, keyboard=keyboard)

    async def send_file(
        self, peer_id: int, file_path: str, filename: str, caption: str = ""
    ) -> int:
        """Загрузить и отправить файл (документ)."""
        logger.info(f"send_file: file={file_path}, peer_id={peer_id}")

        # 1. Получить URL для загрузки
        params = {
            "access_token": self.token,
            "v": self.api_version,
            "type": "doc",
            "peer_id": peer_id,
        }
        url = f"{self.BASE_URL}docs.getMessagesUploadServer?{urlencode(params)}"
        async with self.session.get(url) as resp:
            data = await resp.json()
            if "error" in data:
                raise Exception(f"VK API error getting upload url: {data['error']}")
            upload_url = data["response"]["upload_url"]

        # 2. Загрузить файл
        with open(file_path, "rb") as f:
            content = f.read()
        form_data = FormData()
        form_data.add_field(
            "file", content, filename=filename, content_type="application/json"
        )
        async with self.session.post(upload_url, data=form_data) as resp:
            upload_data = await resp.json()

        # 3. Сохранить документ в VK
        params = {"access_token": self.token, "v": self.api_version}
        params.update(upload_data)
        url = f"{self.BASE_URL}docs.save?{urlencode(params)}"
        async with self.session.post(url) as resp:
            save_data = await resp.json()
        doc = save_data["response"]["doc"]
        doc_id = doc["id"]
        doc_owner_id = doc["owner_id"]

        # 4. Отправить документ (POST для избежания 414)
        attachment = f"doc{doc_owner_id}_{doc_id}"
        payload = {
            "access_token": self.token,
            "v": self.api_version,
            "peer_id": peer_id,
            "attachment": attachment,
            "random_id": int(time.time() * 1000),
        }
        if caption:
            payload["message"] = caption
        url = f"{self.BASE_URL}messages.send"
        async with self.session.post(url, data=payload) as resp:
            result = await resp.json()
        return result[0]["message_id"] if isinstance(result, list) else result

    async def edit_message(
        self, peer_id: int, message_id: int, text: str, keyboard: Optional[dict] = None
    ) -> bool:
        """Редактирует существующее сообщение (бот должен быть автором)."""
        params = {
            "peer_id": peer_id,
            "message_id": message_id,
            "message": text,
            "access_token": self.token,
            "v": self.api_version,
        }
        if keyboard is not None:
            params["keyboard"] = json.dumps(keyboard)
        url = f"{self.BASE_URL}messages.edit"
        async with self.session.post(url, data=params) as resp:
            data = await resp.json()
            if "error" in data:
                logger.error(f"Failed to edit message {message_id}: {data['error']}")
                return False
            logger.info(f"Edited message {message_id} successfully")
            return True

    # ---------- Работа с аттачами ----------

    def get_attachment_download_url(self, attachment: dict) -> Optional[Tuple[str, str]]:
        """
        Возвращает (url, filename) для скачивания аттача или None.
        Поддерживает: photo, doc, audio, video, sticker, audio_message.
        """
        att_type = attachment.get("type")
        att_data = attachment.get(att_type, {})

        if att_type == "photo":
            # Берем фото максимального размера
            sizes = att_data.get("sizes", [])
            if not sizes:
                return None
            # Сортируем по размеру (type: 's' < 'm' < 'x' < 'y' < 'z' < 'w')
            size_priority = {"s": 1, "m": 2, "x": 3, "y": 4, "z": 5, "w": 6}
            sizes_sorted = sorted(
                sizes,
                key=lambda s: size_priority.get(s.get("type", "x"), 3),
                reverse=True,
            )
            url = sizes_sorted[0].get("url")
            if not url:
                return None
            # Генерируем имя файла
            photo_id = att_data.get("id", "unknown")
            ext = ".jpg"  # VK photos are always jpg
            filename = f"photo_{photo_id}{ext}"
            return url, filename

        elif att_type == "doc":
            url = att_data.get("url")
            if not url:
                return None
            filename = att_data.get("title", f"doc_{att_data.get('id', 'unknown')}")
            return url, filename

        elif att_type == "audio":
            url = att_data.get("url")
            if not url:
                return None
            artist = att_data.get("artist", "unknown")
            title = att_data.get("title", "unknown")
            filename = f"{artist} - {title}.mp3"
            return url, filename

        elif att_type == "video":
            # Видео требует спец. запрос для получения URL
            # Для простоты возвращаем информацию о видео
            video_id = att_data.get("id", "unknown")
            owner_id = att_data.get("owner_id", "")
            title = att_data.get("title", f"video_{video_id}")
            logger.info(f"Video attachment: {title}, owner_id={owner_id}, video_id={video_id}")
            return None  # Видео сложно скачать напрямую

        elif att_type == "audio_message":
            # Голосовое сообщение - может быть mp3 или ogg
            url = att_data.get("link_mp3")
            ext = ".mp3"
            if not url:
                url = att_data.get("link_ogg")
                ext = ".ogg"
            if not url:
                logger.debug(f"audio_message has no link_mp3 or link_ogg: {att_data.keys()}")
                return None
            duration = att_data.get("duration", 0)
            filename = f"voice_msg_{duration}s{ext}"
            logger.debug(f"Found audio_message URL: {url[:50]}...")
            return url, filename

        elif att_type == "sticker":
            # Стикер - берем изображение максимального размера
            images = att_data.get("images", [])
            if not images:
                return None
            # Берем последнее (самое большое)
            url = images[-1].get("url") if images else None
            if not url:
                return None
            sticker_id = att_data.get("sticker_id", "unknown")
            filename = f"sticker_{sticker_id}.png"
            return url, filename

        else:
            logger.warning(f"Unsupported attachment type: {att_type}")
            return None

    async def download_attachment(self, url: str, save_path: Path) -> bool:
        """Скачивает файл по URL и сохраняет в save_path."""
        try:
            async with self.session.get(url) as resp:
                if resp.status != 200:
                    logger.error(f"Failed to download {url}: status {resp.status}")
                    return False
                content = await resp.read()

            save_path.parent.mkdir(parents=True, exist_ok=True)
            with open(save_path, "wb") as f:
                f.write(content)

            logger.debug(f"Downloaded attachment to {save_path}")
            return True
        except Exception as e:
            logger.error(f"Error downloading attachment: {e}")
            return False

    async def download_attachments(
        self, attachments: List[dict], save_dir: Path
    ) -> List[dict]:
        """
        Скачивает все аттачи в папку save_dir.
        Возвращает список скачанных аттачей с путями:
        [{"type": "photo", "path": "/path/to/file", "filename": "...", "original": {...}}, ...]
        """
        if not attachments:
            return []

        save_dir.mkdir(parents=True, exist_ok=True)
        downloaded = []

        # Генерируем таймстамп один раз для всех аттачей в сообщении
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

        for att in attachments:
            result = self.get_attachment_download_url(att)
            if not result:
                logger.debug(f"Could not get download URL for attachment type: {att.get('type')}")
                continue

            url, filename = result
            # Очищаем имя файла от недопустимых символов
            safe_filename = "".join(
                c if c.isalnum() or c in ".-_" else "_" for c in filename
            )
            # Добавляем таймстамп в начало имени файла
            timestamped_filename = f"{timestamp}_{safe_filename}"
            save_path = save_dir / timestamped_filename

            success = await self.download_attachment(url, save_path)
            if success:
                logger.debug(f"Saved attachment [{att.get('type')}] to {save_path}")
                downloaded.append({
                    "type": att.get("type"),
                    "path": str(save_path),
                    "filename": save_path.name,
                    "original": att,
                })

        return downloaded
