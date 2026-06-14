#!/usr/bin/env python3
"""
Модуль для загрузки и транскрибации аудиосообщений из VK
"""

import asyncio
import logging
import tempfile
from pathlib import Path
from typing import Optional
from aiohttp import ClientSession, ClientTimeout

from faster_whisper import WhisperModel

logger = logging.getLogger("vk-transcriber")


class AudioTranscriber:
    """Загружает и транскрибирует аудиосообщения."""
    
    def __init__(self, model_size: str = "large-v3", device: str = "auto"):
        """
        Инициализирует транскрибер.
        
        Args:
            model_size: Размер модели Whisper (small, medium, large-v3)
            device: Устройство для вычислений (auto, cuda, cpu)
        """
        self.model_size = model_size
        self.device = device
        self.model: Optional[WhisperModel] = None
        self._model_lock = asyncio.Lock()
    
    async def get_model(self) -> WhisperModel:
        """Ленивая загрузка модели."""
        if self.model is None:
            async with self._model_lock:
                if self.model is None:
                    logger.info(f"Загрузка модели Whisper {self.model_size}...")
                    compute_type = "float16" if self.device == "cuda" else "int8"
                    self.model = WhisperModel(
                        self.model_size,
                        device=self.device,
                        compute_type=compute_type
                    )
                    logger.info("Модель загружена")
        return self.model
    
    async def transcribe_audio_file(self, audio_path: str) -> str:
        """
        Транскрибирует аудиофайл.
        
        Args:
            audio_path: Путь к аудиофайлу
            
        Returns:
            Транскрибированный текст
        """
        model = await self.get_model()
        
        logger.info(f"Транскрибация: {audio_path}")
        segments, info = model.transcribe(
            audio_path,
            language="ru",
            beam_size=5,
            vad_filter=True
        )
        
        text = "".join(segment.text for segment in segments)
        logger.info(f"Транскрибация завершена: {len(text)} символов")
        
        return text.strip()


class VKAudioDownloader:
    """Загружает аудиосообщения из VK."""
    
    def __init__(self, vk_token: str, vk_api_version: str = "5.200"):
        self.token = vk_token
        self.vk_api_version = vk_api_version
        self.base_url = "https://api.vk.com/method/"
    
    async def get_audio_message_url(self, message_id: int, peer_id: int) -> Optional[str]:
        """
        Получает URL для скачивания аудиосообщения из сообщения.
        
        Args:
            message_id: ID сообщения
            peer_id: ID чата/пользователя
            
        Returns:
            URL для скачивания или None
        """
        try:
            async with ClientSession(timeout=ClientTimeout(total=30)) as session:
                # Получаем полное сообщение с вложениями
                params = {
                    "access_token": self.token,
                    "v": self.vk_api_version,
                    "message_ids": message_id,
                    "peer_id": peer_id
                }
                
                url = f"{self.base_url}messages.getById?{self._urlencode(params)}"
                async with session.get(url) as resp:
                    data = await resp.json()
                    
                if "error" in data:
                    logger.error(f"VK API error: {data['error']}")
                    return None
                
                items = data.get("response", {}).get("items", [])
                if not items:
                    logger.error("Сообщение не найдено")
                    return None
                
                msg = items[0]
                attachments = msg.get("attachments", [])
                
                # Ищем аудиосообщение среди вложений
                for attachment in attachments:
                    if attachment.get("type") == "audio_message":
                        audio_msg = attachment.get("audio_message", {})
                        url = audio_msg.get("url")
                        if url:
                            logger.info(f"Найдено аудиосообщение: {url}")
                            return url
                
                logger.error("Аудиосообщение не найдено в вложениях")
                return None
                
        except Exception as e:
            logger.exception(f"Ошибка получения URL аудиосообщения: {e}")
            return None
    
    async def download_audio(self, url: str, output_path: str) -> bool:
        """
        Скачивает аудиофайл по URL.
        
        Args:
            url: URL для скачивания
            output_path: Путь для сохранения
            
        Returns:
            True если успешно
        """
        try:
            async with ClientSession(timeout=ClientTimeout(total=120)) as session:
                async with session.get(url) as resp:
                    if resp.status != 200:
                        logger.error(f"HTTP error: {resp.status}")
                        return False
                    
                    with open(output_path, "wb") as f:
                        async for chunk in resp.content.iter_chunked(8192):
                            f.write(chunk)
                    
                    logger.info(f"Аудио скачано: {output_path} ({resp.content_length} байт)")
                    return True
                    
        except Exception as e:
            logger.exception(f"Ошибка скачивания аудио: {e}")
            return False
    
    def _urlencode(self, params: dict) -> str:
        """Кодирование параметров URL."""
        return "&".join(f"{k}={v}" for k, v in params.items())


class AudioMessageHandler:
    """Обработчик аудиосообщений с полной интеграцией."""
    
    def __init__(self, vk_token: str, vk_api_version: str = "5.200"):
        self.downloader = VKAudioDownloader(vk_token, vk_api_version)
        self.transcriber = AudioTranscriber()
        self.temp_dir = Path(tempfile.gettempdir()) / "vk_audio"
        self.temp_dir.mkdir(exist_ok=True)
    
    async def process_audio_message(self, message_id: int, peer_id: int) -> Optional[str]:
        """
        Полная обработка аудиосообщения: загрузка + транскрибация.
        
        Args:
            message_id: ID сообщения
            peer_id: ID чата/пользователя
            
        Returns:
            Транскрибированный текст или None
        """
        # Получаем URL
        url = await self.downloader.get_audio_message_url(message_id, peer_id)
        if not url:
            return None
        
        # Создаём временный файл
        audio_path = self.temp_dir / f"{message_id}.ogg"
        
        # Скачиваем
        if not await self.downloader.download_audio(url, str(audio_path)):
            return None
        
        # Транскрибируем
        try:
            text = await self.transcriber.transcribe_audio_file(str(audio_path))
            return text
        finally:
            # Очищаем файл
            try:
                audio_path.unlink()
            except:
                pass
    
    async def cleanup_old_files(self):
        """Очистка старых временных файлов."""
        import time
        now = time.time()
        for f in self.temp_dir.iterdir():
            if f.is_file() and now - f.stat().st_mtime > 3600:
                try:
                    f.unlink()
                except:
                    pass
