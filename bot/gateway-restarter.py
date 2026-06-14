#!/usr/bin/env python3
"""
VK Gateway Reloader
Слушает команды /update, /b и управляет перезапуском main.py
"""

import argparse
import asyncio
import json
import logging
import os
import signal
import subprocess
import sys
import time
from pathlib import Path
from typing import Optional, Tuple
from urllib.parse import urlencode

import aiohttp
from aiohttp import ClientSession, ClientTimeout

# Парсинг аргументов
parser = argparse.ArgumentParser(description="VK Gateway Reloader")
parser.add_argument("--autostart", action="store_true", help="Auto-start main.py on launch")

if __name__ == "__main__":
    args = parser.parse_args()
else:
    args = parser.parse_args([])

# Настройка логирования
logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("vk-reloader")

# Пути
SCRIPT_DIR = Path(__file__).parent.resolve()
MAIN_SCRIPT = SCRIPT_DIR / "main.py"
PID_FILE = SCRIPT_DIR / ".gateway.pid"

def load_config() -> Tuple[str, int, Optional[str]]:
    """Загружает токен, peer_id и llama_server_host из config.json."""
    config_path = SCRIPT_DIR / "config.json"
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            config = json.load(f)
        token = config.get("vk_token", "")
        if not token:
            raise ValueError("vk_token is empty in config.json")
        notify_peer_id = config.get("peer_id", 2000000000)
        llama_server_host = config.get("llama_server_host", "")
        return token, notify_peer_id, llama_server_host
    except FileNotFoundError:
        raise FileNotFoundError(f"Config file not found: {config_path}")
    except json.JSONDecodeError as e:
        raise ValueError(f"Invalid JSON in config: {e}")


class VKClient:
    BASE_URL = "https://api.vk.com/method/"

    def __init__(self, token: str, api_version: str = "5.200"):
        self.token = token
        self.api_version = api_version
        self.session: aiohttp.ClientSession = None

    async def __aenter__(self):
        self.session = ClientSession(timeout=ClientTimeout(total=30))
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.session:
            await self.session.close()

    async def _api_request(self, method: str, params: dict) -> dict:
        params["access_token"] = self.token
        params["v"] = self.api_version
        url = f"{self.BASE_URL}{method}?{urlencode(params)}"
        async with self.session.get(url) as resp:
            data = await resp.json()
            if "error" in data:
                raise Exception(f"VK API error: {data['error']}")
            return data["response"]

    async def get_long_poll_server(self) -> Tuple[str, str, int]:
        resp = await self._api_request("messages.getLongPollServer", {})
        return resp["server"], resp["key"], int(resp["ts"])

    async def send_message(self, peer_id: int, text: str) -> int:
        params = {
            "peer_id": peer_id,
            "random_id": int(time.time() * 1000),
            "message": text,
        }
        resp = await self._api_request("messages.send", params)
        return resp[0]["message_id"] if isinstance(resp, list) else resp


def get_gateway_pid() -> Optional[int]:
    """Читает PID основного процесса из файла."""
    if PID_FILE.exists():
        try:
            with open(PID_FILE, "r") as f:
                return int(f.read().strip())
        except (ValueError, FileNotFoundError):
            pass
    return None


def save_gateway_pid(pid: int):
    """Сохраняет PID основного процесса в файл."""
    with open(PID_FILE, "w") as f:
        f.write(str(pid))


def remove_pid_file():
    """Удаляет файл с PID."""
    if PID_FILE.exists():
        PID_FILE.unlink()


def is_process_running(pid: int) -> bool:
    """Проверяет, запущен ли процесс с данным PID."""
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


import system_status


class LlamaServerMonitor:
    """Мониторит состояние llama-server и уведомляет при падении."""

    def __init__(
        self,
        vk: 'VKClient',
        llama_server_host: Optional[str],
        check_interval: int = 30,
        retry_count: int = 3,
        retry_delay: int = 10
    ):
        self.vk = vk
        self.llama_server_host = llama_server_host
        self.check_interval = check_interval
        self.retry_count = retry_count
        self.retry_delay = retry_delay
        self._was_running = False
        self._running = False

    @property
    def running(self) -> bool:
        return self._running

    def start(self):
        self._running = True
        logger.info(f"LlamaServerMonitor started (interval={self.check_interval}s)")

    async def check_loop(self, notify_peer_id: int):
        """Основной цикл проверки llama-server."""
        self.start()

        while self._running:
            await asyncio.sleep(self.check_interval)

            if not self._running:
                break

            # Проверяем с retry логикой
            is_running = False
            last_error = None
            for attempt in range(self.retry_count):
                is_running, error = await system_status.is_llama_server_running(self.llama_server_host)
                if is_running:
                    break
                last_error = error
                if attempt < self.retry_count - 1:
                    logger.warning(
                        f"Llama-server check failed (attempt {attempt + 1}/{self.retry_count}): {error}. "
                        f"Retrying in {self.retry_delay}s..."
                    )
                    await asyncio.sleep(self.retry_delay)

            if self._was_running and not is_running:
                logger.warning(f"Llama-server is down! Last error: {last_error}")
                try:
                    await self.vk.send_message(
                        notify_peer_id,
                        f"⚠️ Llama-server упал! Ошибка: {last_error}"
                    )
                except Exception as e:
                    logger.error(f"Failed to send llama-server down notification: {e}")
            elif not is_running:
                logger.warning(f"Llama-server check failed but was not running before: {last_error}")

            self._was_running = is_running
            logger.debug(f"Llama-server check: running={is_running}")

    def stop(self):
        self._running = False
        logger.info("LlamaServerMonitor stopped")


def restart_gateway() -> Tuple[bool, Optional[str]]:
    """
    Перезапускает main.py.

    Returns:
        tuple: (success: bool, error_message: str | None)
    """
    logger.info("=== Restarting main.py ===")
    logger.info(f"SCRIPT_DIR={SCRIPT_DIR}, cwd={Path.cwd()}")

    # Проверяем что main.py существует
    if not MAIN_SCRIPT.exists():
        return False, f"main.py не найден: {MAIN_SCRIPT}"

    # Останавливаем старый процесс
    old_pid = get_gateway_pid()
    if old_pid and is_process_running(old_pid):
        logger.info(f"Stopping existing process (PID: {old_pid})")
        try:
            os.kill(old_pid, signal.SIGTERM)
            time.sleep(2)
            if is_process_running(old_pid):
                logger.warning(f"Process {old_pid} still running, forcing kill")
                os.kill(old_pid, signal.SIGKILL)
        except OSError as e:
            logger.warning(f"Failed to stop process {old_pid}: {e}")
    remove_pid_file()

    # Удаляем старый debug.log
    debug_log = SCRIPT_DIR / "debug.log"
    if debug_log.exists():
        try:
            debug_log.unlink()
            logger.info("Removed old debug.log")
        except Exception as e:
            logger.warning(f"Failed to remove debug.log: {e}")

    # Запускаем новый процесс
    venv_python = SCRIPT_DIR / "venv/bin/python"
    log_file = SCRIPT_DIR / "debug.log"

    try:
        stdout_file = open(log_file, "w")
        proc = subprocess.Popen(
            [str(venv_python), str(MAIN_SCRIPT), "-d"],
            stdout=stdout_file,
            stderr=subprocess.STDOUT,
            cwd=str(SCRIPT_DIR),
        )
        save_gateway_pid(proc.pid)
        logger.info(f"Started main.py (PID: {proc.pid})")

        time.sleep(3)

        if not is_process_running(proc.pid):
            stdout_file.close()
            return False, "Процесс main.py упал сразу после запуска"

        stdout_file.close()
        return True, None
    except Exception as e:
        logger.error(f"Failed to start main.py: {e}")
        return False, str(e)


class VKLongPollReloader:
    def __init__(self, vk: VKClient, llama_server_host: Optional[str] = None):
        self.vk = vk
        self.llama_server_host = llama_server_host
        self.server = None
        self.key = None
        self.ts = None
        self.running = False

    async def _refresh_long_poll_server(self):
        self.server, self.key, self.ts = await self.vk.get_long_poll_server()
        logger.info(f"Long Poll server refreshed: {self.server}")

    async def _get_long_poll_events(self) -> Tuple[list, int]:
        params = {
            "act": "a_check",
            "key": self.key,
            "ts": self.ts,
            "wait": "25",
            "mode": "74",
            "version": "3",
        }
        url = f"https://{self.server}?{urlencode(params)}"
        timeout = ClientTimeout(total=35)
        async with ClientSession(timeout=timeout) as session:
            async with session.get(url) as resp:
                data = await resp.json()
                if "failed" in data:
                    raise Exception(f"Long poll failed: {data}")
                return data.get("updates", []), int(data["ts"])

    async def _handle_message_new(self, event: list):
        msg_id = int(event[1])
        flags = int(event[2])
        peer_id = int(event[3])
        text = event[5] if len(event) > 5 else ""

        # Игнорируем сообщения от себя (флаг 2)
        if flags & 2:
            return

        # Игнорируем сообщения без текста
        if not text.strip():
            return

        logger.info(f"New message from {peer_id}: '{text[:50]}...'")

        parts = text.strip().split()
        command = parts[0].lower() if parts else ""

        if command in ("/update", "/start"):
            await self._handle_update_command(peer_id)
        elif command == "/status":
            await self._handle_status_command(peer_id)
        elif command == "/restart-help":
            await self._send_help(peer_id)
        elif command in ("/b", "/branch"):
            await self._handle_branch_command(peer_id, parts)
        else:
            logger.debug(f"Ignoring message (not a command): '{command}'")

    async def _handle_update_command(self, peer_id: int):
        """Обрабатывает команду /update или /start."""
        logger.info("Received /update command")
        try:
            await self.vk.send_message(peer_id, "🔄 Перезагрузка main.py...")
            success, error = restart_gateway()
            if success:
                await self.vk.send_message(peer_id, "✅ main.py перезапущен")
            else:
                await self.vk.send_message(peer_id, f"❌ Не удалось перезапустить: {error}")
        except Exception as e:
            logger.error(f"Error handling /update: {e}")
            try:
                await self.vk.send_message(peer_id, f"❌ Ошибка: {e}")
            except (aiohttp.ClientError, asyncio.TimeoutError):
                pass

    async def _handle_status_command(self, peer_id: int):
        """Обрабатывает команду /status."""
        logger.info("Received /status command")
        try:
            status_msg = await system_status.get_status_message(self.llama_server_host)
            await self.vk.send_message(peer_id, status_msg)
        except Exception as e:
            logger.error(f"Error handling /status: {e}")
            try:
                await self.vk.send_message(peer_id, f"❌ Ошибка: {e}")
            except (aiohttp.ClientError, asyncio.TimeoutError):
                pass

    async def _send_help(self, peer_id: int):
        """Отправляет справку."""
        help_text = """
🔄 Команды Gateway Restarter:

/update - Перезапустить main.py
/start - То же что /update
/status - Статус системы (RAM, диск, llama-server)

/b <branch> - Переключиться на ветку
/b <branch> -f - Форсированный чекаут (сбросить изменения и подтянуть с сервера)

/restart-help - Показать эту справку
"""
        try:
            await self.vk.send_message(peer_id, help_text)
        except (aiohttp.ClientError, asyncio.TimeoutError):
            pass

    async def _handle_branch_command(self, peer_id: int, parts: list):
        """Handle /b or /branch command to checkout a git branch."""
        if len(parts) < 2:
            await self._send_help(peer_id)
            return

        branch_name = parts[1]
        force = len(parts) > 2 and parts[2].lower() == "-f"

        logger.info(f"Received /branch command: branch={branch_name}, force={force}")

        def _run_git_command(*args, timeout: int = 30) -> Tuple[bool, str]:
            """Run a git command and return (success, output)."""
            try:
                result = subprocess.run(
                    ["git"] + list(args),
                    cwd=str(SCRIPT_DIR),
                    capture_output=True,
                    text=True,
                    timeout=timeout,
                )
                output = result.stdout.strip() or result.stderr.strip()
                return result.returncode == 0, output
            except subprocess.TimeoutExpired:
                return False, "Git command timed out"
            except Exception as e:
                return False, str(e)

        # Сначала обновляем информацию о remote
        await self.vk.send_message(peer_id, f"🔄 Обновляю информацию о ветках...")
        success, output = _run_git_command("fetch", "--all", timeout=60)
        if not success:
            logger.warning(f"fetch failed: {output}")
            # Не прерываем, продолжаем

        # Если форс - сбросить все локальные изменения
        if force:
            await self.vk.send_message(peer_id, f"🔄 Форсированный чекаут на `{branch_name}` (сброс изменений)...")

            # Сбрасываем все локальные изменения
            success, output = _run_git_command("reset", "--hard", "HEAD")
            if not success:
                await self.vk.send_message(peer_id, f"❌ Не удалось сбросить изменения: `{output}`")
                return

            # Удаляем untracked файлы
            success, output = _run_git_command("clean", "-fd")
            if not success:
                logger.warning(f"clean -fd failed (non-critical): {output}")
        else:
            await self.vk.send_message(peer_id, f"🔄 Переключение на ветку `{branch_name}`...")

        # Пробуем чекаут локальной ветки
        success, output = _run_git_command("checkout", branch_name)
        if not success:
            # Ветка не найдена локально - пробуем создать из remote
            logger.info(f"Branch {branch_name} not found locally, trying remote...")
            success, output = _run_git_command("checkout", "-b", branch_name, f"origin/{branch_name}")
            if not success:
                # Пробуем создать пустую локальную ветку
                success, output = _run_git_command("checkout", "-b", branch_name)
                if not success:
                    await self.vk.send_message(
                        peer_id,
                        f"❌ Не удалось переключиться на ветку `{branch_name}`\n`{output}`"
                    )
                    return
                await self.vk.send_message(
                    peer_id,
                    f"✅ Создана новая локальная ветка `{branch_name}` (remote не найден)"
                )
                return
            await self.vk.send_message(
                peer_id,
                f"✅ Создана ветка `{branch_name}` из origin"
            )
            # После создания из origin - подтягиваем свежак
            success, output = _run_git_command("pull", "origin", branch_name)
            if success:
                await self.vk.send_message(peer_id, f"📥 Подтянуты изменения с сервера")
            return

        # Если были на локальной ветке - подтягиваем свежак
        await self.vk.send_message(peer_id, f"✅ Переключено на ветку `{branch_name}`")

        # Подтягиваем изменения с сервера
        success, output = _run_git_command("pull", "origin", branch_name, timeout=60)
        if success:
            # Проверяем были ли изменения
            if "Already up to date" in output or "Уже обновлено" in output:
                await self.vk.send_message(peer_id, f"📥 Ветка уже актуальна")
            else:
                await self.vk.send_message(peer_id, f"📥 Подтянуты изменения с сервера")
        else:
            logger.warning(f"pull failed: {output}")
            # Не критично если pull не удался

    async def run(self):
        self.running = True
        await self._refresh_long_poll_server()

        logger.info("VK Reloader started. Waiting for commands...")

        while self.running:
            try:
                updates, new_ts = await self._get_long_poll_events()
                self.ts = new_ts

                for update in updates:
                    if not isinstance(update, list):
                        continue
                    event_type = update[0]
                    if event_type == 4:  # message_new
                        asyncio.create_task(self._handle_message_new(update))

            except asyncio.CancelledError:
                break
            except (asyncio.TimeoutError, aiohttp.ClientError) as e:
                logger.warning(f"Long poll error: {e}. Reconnecting...")
                await asyncio.sleep(3)
                await self._refresh_long_poll_server()
            except Exception as e:
                logger.exception(f"Long poll error: {e}")
                await asyncio.sleep(3)
                await self._refresh_long_poll_server()

    async def stop(self):
        self.running = False
        logger.info("VK Reloader stopped")


async def main():
    logger.info("=== VK Gateway Reloader ===")
    logger.info(f"Script directory: {SCRIPT_DIR}")
    logger.info(f"Main script: {MAIN_SCRIPT}")

    if not MAIN_SCRIPT.exists():
        logger.error(f"main.py not found: {MAIN_SCRIPT}")
        return

    try:
        token, notify_peer_id, llama_server_host = load_config()
        logger.info(f"VK token loaded (len={len(token)})")
        logger.info(f"Notify peer_id: {notify_peer_id}")
        logger.info(f"Llama server host: {llama_server_host or '(not configured)'}")
    except Exception as e:
        logger.error(f"Failed to load config: {e}")
        return

    # Автозапуск при старте
    if args.autostart:
        logger.info("Starting main.py on reloader startup (--autostart)...")
        success, error = restart_gateway()
        if success:
            logger.info("main.py started successfully")
        else:
            logger.warning(f"Failed to start main.py: {error}")

    async with VKClient(token) as vk:
        try:
            await vk.send_message(notify_peer_id, "✅ Gateway Restarter запущен")
        except Exception as e:
            logger.warning(f"Failed to send startup notification: {e}")

        monitor = LlamaServerMonitor(vk, llama_server_host, check_interval=30)
        monitor_task = asyncio.create_task(monitor.check_loop(notify_peer_id))

        poller = VKLongPollReloader(vk, llama_server_host)
        try:
            await poller.run()
        except (KeyboardInterrupt, asyncio.CancelledError):
            logger.info("Shutting down...")
            monitor.stop()
            try:
                await monitor_task
            except asyncio.CancelledError:
                pass
            await poller.stop()


if __name__ == "__main__":
    asyncio.run(main())
