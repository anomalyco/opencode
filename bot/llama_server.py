"""
Управление llama сервером
"""
import asyncio
import json
import os
import shlex
import subprocess
from pathlib import Path
from typing import Optional, Tuple, Set

import aiohttp

from config import (
    SCRIPT_DIR,
    LLAMA_SERVER_PATH,
    LLAMA_SERVER_HOST,
    PROVIDER_URL,
    load_config,
)
from logging_config import logger
from models import get_model_by_alias, get_current_model
from config import MODELS


# Константы
LLAMA_STARTUP_TIMEOUT = 300  # секунд
LLAMA_CHECK_INTERVAL = 5  # секунд
MAX_LOG_SIZE = 5 * 1024 * 1024  # 5 МБ для лога

# Множество для хранения фоновых задач, чтобы не GC-ились
_log_reader_tasks: Set[asyncio.Task] = set()


async def _log_reader(proc: subprocess.Popen, log_path: str, max_size: int = MAX_LOG_SIZE):
    """Читает stdout процесса и пишет в лог, усекая до max_size."""
    tmp = log_path + ".tmp"
    loop = asyncio.get_running_loop()
    with open(log_path, "ab") as f:
        while True:
            line = await loop.run_in_executor(None, proc.stdout.readline)
            if not line:
                break
            f.write(line)
            if os.fstat(f.fileno()).st_size > max_size:
                f.close()
                subprocess.run(
                    ["tail", "-c", str(max_size), log_path],
                    capture_output=True, stdout=open(tmp, "wb"), check=False,
                )
                os.replace(tmp, log_path)
                f = open(log_path, "ab")
    f.close()


async def restart_llama_server(
    model: dict, alias: str = None, llama_path: str = None
) -> bool:
    """Перезапускает llama server с указанной моделью."""
    # Путь к llama-server: сначала из модели, потом из глобального конфига
    server_path = model.get("llama_server_path") or llama_path

    if server_path is None:
        logger.error("llama_path is empty")

    if not server_path:
        logger.info("llama-server not configured, skipping restart")
        return True

    if not model or not model.get("args"):
        logger.error("No model args provided")
        return False

    # Убиваем предыдущий процесс llama-server по имени
    try:
        subprocess.run(["pkill", "-9", "-f", "llama-server"], capture_output=True)
        logger.info("Killed previous llama-server process")
        await asyncio.sleep(1)
    except Exception as e:
        logger.warning(f"Failed to kill previous llama-server: {e}")

    path = server_path
    args = model.get("args", "")
    cmd = f"{path} {args}"

    try:
        env = os.environ.copy()
        env.pop("TMUX", None)

        log_path = f"/tmp/llama-server-{alias or 'unknown'}.log"
        logger.info(f"Starting llama server, logging to {log_path}")

        proc = subprocess.Popen(
            shlex.split(cmd),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            env=env,
            start_new_session=True,
        )

        if proc:
            logger.info(
                f"Started llama server with model {alias or 'unknown'}, pid={proc.pid}"
            )
            task = asyncio.ensure_future(_log_reader(proc, log_path))
            _log_reader_tasks.add(task)
            task.add_done_callback(_log_reader_tasks.discard)
            await asyncio.sleep(3)
            return True
        return False
    except Exception as e:
        logger.error(f"Failed to start llama server: {e}")
        return False


async def wait_for_llama_server(
    timeout: int = LLAMA_STARTUP_TIMEOUT,
    interval: int = LLAMA_CHECK_INTERVAL,
    model_alias: str = None,
) -> bool:
    """Ждёт готовности llama сервера."""
    # Используем URL из конфига, добавляем / если нет
    url = LLAMA_SERVER_HOST.rstrip("/") + "/"
    
    waited = 0

    while waited < timeout:
        await asyncio.sleep(interval)
        waited += interval
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(url, timeout=2) as resp:
                    if resp.status == 200:
                        return True
        except (aiohttp.ClientError, asyncio.TimeoutError):
            pass

    log_path = f"/tmp/llama-server-{model_alias or 'unknown'}.log"
    logger.error(
        f"llama-server did not start within {timeout}s. "
        f"Check log for details: {log_path}"
    )
    return False



def save_model_config(alias: str) -> bool:
    """Сохраняет алиас модели в конфиг файл (default_model)."""
    try:
        config = load_config()
        config["default_model"] = alias
        with open(SCRIPT_DIR / "config.json", "w") as f:
            json.dump(config, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        logger.warning(f"Failed to save config: {e}")
        return False


async def test_llama_server_speed(complete_url: str, model_name: str = None) -> Tuple[Optional[str], Optional[str]]:
    """
    Тестирует скорость инференса llama-server, отправляя короткий запрос.
    
    Args:
        complete_url: Полный URL llama-server (например, http://192.168.1.212:8081)
        model_name: Имя модели для отправки в запросе (опционально)
    
    Returns:
        Tuple[speed_string, error_message] - один из элементов будет None
    """
    if not complete_url:
        return None, "❌ Не указан URL llama-server"
    
    # Убедимся, что URL не заканчивается на слеш
    if complete_url.endswith("/"):
        complete_url = complete_url.rstrip("/")
    
    test_url = f"{complete_url}/completion"
    logger.info(f"Testing llama-server speed at {test_url}")
    
    try:
        async with aiohttp.ClientSession() as session:
            payload = {
                "prompt": "Test",
                "n_predict": 10,
                "stream": False,
                "temperature": 0.7,
            }
            if model_name:
                payload["model"] = model_name
            
            async with session.post(
                test_url,
                json=payload,
                timeout=aiohttp.ClientTimeout(total=30)
            ) as resp:
                if resp.status != 200:
                    return None, f"❌ Ошибка HTTP {resp.status}"
                
                data = await resp.json()
                
                if "timings" not in data:
                    return None, "❌ В ответе нет информации о timing"
                
                timings = data["timings"]
                predicted_ms = timings.get("predicted_ms", 0)
                predicted_n = timings.get("predicted_n", 0)
                model_name = data.get("model", "unknown")
                
                if predicted_n > 0:
                    # Скорость в токенах в секунду
                    tps = predicted_n / (predicted_ms / 1000)
                    speed_string = (
                        f"⚡ **Llama-server Speed Test**\n\n"
                        f"📊 Модель: `{model_name}`\n"
                        f"⏱️  Время генерации: {predicted_ms:.0f}ms\n"
                        f"🔢 Токенов: {predicted_n}\n"
                        f"🚀 Скорость: **{tps:.1f} tok/s**\n"
                        f"⏳ На токен: {predicted_ms/predicted_n:.1f}ms"
                    )
                    return speed_string, None
                else:
                    return None, "❌ Не удалось получить количество токенов"
                    
    except asyncio.TimeoutError:
        return None, "❌ Тайм-аут подключения"
    except aiohttp.ClientError as e:
        return None, f"❌ Ошибка подключения: {str(e)}"
    except Exception as e:
        logger.error(f"Error testing llama-server speed: {e}")
        return None, f"❌ Ошибка: {str(e)}"


async def do_restart(
    vk_client,
    user_id: int,
    model_alias: str = None,
    opencode_process=None,
    session_mgr=None,
    current_default: str = None,
) -> Tuple[Optional[str], Optional[str]]:
    """
    Выполняет перезапуск с указанной моделью или текущей.

    Последовательность:
    1) llama server restart (если LLAMA_SERVER_PATH указан)
    2) Ждём llama ready
    3) restart opencode с новой моделью (CLI аргументы)
    4) save_model_config (сохраняем в config.json бота)
    5) reload config (обновляем DEFAULT_MODEL в памяти)
    6) clean sessions

    Args:
        vk_client: Клиент VK для отправки сообщений
        user_id: ID пользователя
        model_alias: Алиас модели (если None, используется текущая)
        opencode_process: Процесс OpenCode для перезапуска
        session_mgr: Менеджер сессий
        current_default: Текущий дефолтный алиас (передаётся извне)

    Returns:
        Tuple[model_name, error_message] - один из элементов будет None
    """
    if model_alias:
        model = get_model_by_alias(model_alias)
        if not model:
            return None, f"Модель '{model_alias}' не найдена"
        alias = model_alias
    else:
        model = get_current_model()
        if not model:
            return None, "Нет доступных моделей"
        alias = current_default or "default"

    # Шаг 1: llama server
    await vk_client.send_message(user_id, f"🔄 Загружаю модель {alias}...")
    llama_success = await restart_llama_server(model, alias, LLAMA_SERVER_PATH)
    if not llama_success:
        await vk_client.send_message(user_id, "⚠️ Не удалось запустить llama server")
        logger.warning("Failed to restart llama server")

    # Шаг 2: Ждём пока модель загрузится (важно: ждём ДО обновления конфига opencode)
    ready = await wait_for_llama_server(model_alias=alias)

    if ready:
        await vk_client.send_message(user_id, f"✅ Модель {alias} загружена и готова!")
        logger.info(f"Model {alias} loaded successfully")
    else:
        await vk_client.send_message(
            user_id, f"⚠️ Модель {alias} не ответила за {LLAMA_STARTUP_TIMEOUT} сек, продолжаю..."
        )
        logger.warning(f"Model {alias} did not respond in time")

    # Шаг 3: Перезапускаем opencode с новой моделью (CLI аргументы).
    # Используем реальное имя модели (model.get("model")) для --model флага
    real_model_name = model.get("model", alias)
    if opencode_process:
        await opencode_process.restart(model=real_model_name, provider_url=PROVIDER_URL)

    # Шаг 4: Сохраняем в config.json бота (только алиас)
    save_model_config(alias)

    # Шаг 5: Обновляем DEFAULT_MODEL в памяти
    import importlib
    import config
    importlib.reload(config)

    # Шаг 6: Очищаем сессии текущего пользователя
    if session_mgr:
        session_mgr.remove(user_id)
        logger.info(
            f"Cleared session for user {user_id} after model switch to {alias}"
        )

    return real_model_name, None
