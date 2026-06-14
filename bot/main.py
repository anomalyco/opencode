#!/usr/bin/env python3
"""
OpenCode VK Gateway Bot (Long Poll версия)
Использует текстовые inline-кнопки для вопросов.
Поддерживает отправку промежуточных рассуждений в отдельный чат (thinking_peer_id).
Конфигурация загружается из JSON-файла.
"""

import asyncio
import subprocess
from pathlib import Path

import config as bot_config
from config import (
    SESSION_FILE,
    LLAMA_SERVER_PATH,
    PEER_ID,
    SCRIPT_DIR,
    args,
    VK_TOKEN,
    VK_API_VERSION,
)
from logging_config import setup_logging, logger
from opencode_process import OpenCodeProcess
from session_manager import SessionManager
from vk_longpoll import VKLongPoll
from vk_client import VKClient
from llama_server import restart_llama_server
from models import get_current_model
from config import DEFAULT_MODEL
import vk_keyboards


async def send_configs_as_attachments(vk: VKClient, peer_id: int, opencode_process: OpenCodeProcess):
    """Генерирует конфиги и отправляет их как аттачи."""
    from config import OPENCODE_CONFIG_PATH

    config_json_path = SCRIPT_DIR / "config.json"

    # Считываем конфиги
    try:
        project_config_text = config_json_path.read_text(encoding="utf-8")
        config_path = Path(OPENCODE_CONFIG_PATH).expanduser()
        opencode_config_text = config_path.read_text(encoding="utf-8")
    except Exception as e:
        logger.warning(f"Failed to read configs for attachment: {e}")
        return

    # Сохраняем временные файлы
    tmp_dir = SCRIPT_DIR / "tmp_startup_configs"
    tmp_dir.mkdir(exist_ok=True)

    project_config_path = tmp_dir / "config.json"
    opencode_config_path = tmp_dir / "opencode_generated.json"

    project_config_path.write_text(project_config_text, encoding="utf-8")
    opencode_config_path.write_text(opencode_config_text, encoding="utf-8")

    # Отправляем первым — проект конфиг
    try:
        await vk.send_file(peer_id, str(project_config_path), "config.json", "📄 Project config.json")
    except Exception as e:
        logger.warning(f"Failed to send project config: {e}")

    # Отправляем вторым — сгенерированный opencode конфиг
    try:
        await vk.send_file(peer_id, str(opencode_config_path), "opencode_generated.json", "📄 Generated opencode config")
    except Exception as e:
        logger.warning(f"Failed to send opencode config: {e}")

    # Убираем временные файлы через пару секунд
    await asyncio.sleep(2)
    try:
        project_config_path.unlink(missing_ok=True)
        opencode_config_path.unlink(missing_ok=True)
        if tmp_dir.exists():
            tmp_dir.rmdir()
    except Exception as e:
        logger.warning(f"Failed to cleanup temp configs: {e}")


async def main():
    # Настройка логирования
    setup_logging(args.debug)
    logger.debug("DEBUG logging enabled - this is a test debug message")

    session_mgr = SessionManager(SESSION_FILE)
    logger.info(f"main() starting: SCRIPT_DIR={SCRIPT_DIR}, cwd={Path.cwd()}")

    # Запуск llama сервера (опционально)
    if LLAMA_SERVER_PATH:
        try:
            result = subprocess.run(
                ["tmux", "has-session", "-t", "llama"], capture_output=True
            )
            if result.returncode != 0:
                logger.info("llama tmux session not found, starting with default model")
                current_model = get_current_model()
                if current_model:
                    await restart_llama_server(current_model, DEFAULT_MODEL, LLAMA_SERVER_PATH)
                else:
                    logger.warning("No models configured, cannot start llama server")
        except Exception as e:
            logger.warning(f"Failed to check llama session: {e}")
    else:
        logger.info("LLAMA_SERVER_PATH not set, skipping llama server check")

    # Определяем workdir: сначала из сохранённых сессий, иначе SCRIPT_DIR
    workdir = SCRIPT_DIR
    if session_mgr.session_workdir:
        first_session_id = next(iter(session_mgr.session_workdir))
        workdir = Path(session_mgr.session_workdir[first_session_id])
        logger.info(f"Restored workdir from session {first_session_id}: {workdir}")

    opencode_process = OpenCodeProcess(model=bot_config.CLI_MODEL, provider_url=bot_config.PROVIDER_URL, workdir=workdir)
    logger.info(f"OpenCodeProcess created with workdir={opencode_process.workdir}")
    await opencode_process.start()

    async with VKClient(
        token=VK_TOKEN, api_version=VK_API_VERSION
    ) as vk:
        try:
            await vk.send_message(
                PEER_ID,
                f"🤖 OpenCode VK Gateway запущен\n\nModel: {bot_config.DEFAULT_MODEL}\nWorkdir: {workdir}",
                keyboard=vk_keyboards.get_main_keyboard(),
            )
        except Exception as e:
            logger.warning(f"Failed to send startup message: {e}")

        poller = VKLongPoll(vk, session_mgr, opencode_process)
        
        try:
            await poller.run()
        except KeyboardInterrupt:
            logger.info("Shutting down...")
            await poller.stop()
        finally:
            await opencode_process.stop()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass  # Graceful shutdown
