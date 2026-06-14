"""
Функции для получения статуса системы.
"""
import asyncio
import platform
import shutil
import subprocess
from pathlib import Path
from typing import Optional, Tuple

import aiohttp
from aiohttp import ClientTimeout


SCRIPT_DIR = Path(__file__).parent.resolve()


async def is_llama_server_running(llama_server_host: Optional[str]) -> Tuple[bool, Optional[str]]:
    """
    Проверяет, запущен ли llama-server на удалённом хосте.

    Returns:
        Tuple[bool, Optional[str]]: (is_running, error_message)
    """
    if not llama_server_host:
        return True, None

    try:
        timeout = ClientTimeout(total=10)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get(llama_server_host) as resp:
                if resp.status == 200:
                    return True, None
                return False, f"HTTP status {resp.status}"
    except asyncio.TimeoutError:
        return False, "timeout (>10s)"
    except aiohttp.ClientError as e:
        return False, str(e)
    except Exception as e:
        return False, f"unexpected error: {e}"


def get_memory_info() -> str:
    """Возвращает информацию о свободной оперативной памяти."""
    system = platform.system()

    try:
        if system == "Darwin":  # macOS
            result = subprocess.run(
                ["vm_stat"],
                capture_output=True,
                text=True,
                timeout=5
            )
            if result.returncode == 0:
                # Парсим vm_stat
                pages_free = 0
                pages_inactive = 0
                for line in result.stdout.split("\n"):
                    if "Pages free:" in line:
                        pages_free = int(line.split(":")[1].strip().rstrip("."))
                    elif "Pages inactive:" in line:
                        pages_inactive = int(line.split(":")[1].strip().rstrip("."))

                # Размер страницы обычно 4096 байт
                page_size = 4096
                free_mb = (pages_free + pages_inactive) * page_size // (1024 * 1024)

                # Получаем.total память
                total_result = subprocess.run(
                    ["sysctl", "-n", "hw.memsize"],
                    capture_output=True,
                    text=True,
                    timeout=5
                )
                if total_result.returncode == 0:
                    total_bytes = int(total_result.stdout.strip())
                    total_gb = total_bytes / (1024 ** 3)
                    return f"{free_mb} MB свободно / {total_gb:.1f} GB всего"
                return f"{free_mb} MB свободно"

        elif system == "Linux":
            with open("/proc/meminfo", "r") as f:
                meminfo = f.read()

            mem_free = 0
            mem_available = 0
            mem_total = 0

            for line in meminfo.split("\n"):
                if line.startswith("MemTotal:"):
                    mem_total = int(line.split()[1]) // 1024  # в MB
                elif line.startswith("MemAvailable:"):
                    mem_available = int(line.split()[1]) // 1024
                elif line.startswith("MemFree:"):
                    mem_free = int(line.split()[1]) // 1024

            available = mem_available or mem_free
            total_gb = mem_total / 1024
            return f"{available} MB свободно / {total_gb:.1f} GB всего"

        else:
            return f"ОС не поддерживается: {system}"

    except Exception as e:
        return f"Ошибка: {e}"


def get_disk_info() -> str:
    """Возвращает информацию о свободном месте на диске."""
    try:
        usage = shutil.disk_usage(SCRIPT_DIR)
        free_gb = usage.free / (1024 ** 3)
        total_gb = usage.total / (1024 ** 3)
        used_percent = (usage.used / usage.total) * 100
        return f"{free_gb:.1f} GB свободно / {total_gb:.1f} GB всего ({used_percent:.0f}% занято)"
    except Exception as e:
        return f"Ошибка: {e}"


async def get_status_message(llama_server_host: Optional[str]) -> str:
    """Формирует сообщение о статусе системы."""
    lines = ["📊 Статус системы:"]

    # Память
    memory = get_memory_info()
    lines.append(f"\n💾 RAM: {memory}")

    # Диск
    disk = get_disk_info()
    lines.append(f"💿 Диск: {disk}")

    # Llama-server
    if llama_server_host:
        is_running, error = await is_llama_server_running(llama_server_host)
        if is_running:
            lines.append(f"🦙 Llama-server: ✅ запущен ({llama_server_host})")
        else:
            lines.append(f"🦙 Llama-server: ❌ не доступен ({error})")
    else:
        lines.append("🦙 Llama-server: не настроен")

    return "\n".join(lines)
