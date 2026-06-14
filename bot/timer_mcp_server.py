"""
MCP Timer Server - сервер для постановки таймеров с callback через OpenCode API.
Протокол: MCP STDIO (JSON-RPC over stdin/stdout)
"""
import asyncio
import json
import os
import signal
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

import aiohttp

# ---------- Конфигурация ----------
TIMERS_FILE = Path(__file__).parent / "timers.json"
OPENCODE_URL = os.environ.get("OPENCODE_URL", "http://127.0.0.1:4096")
SESSIONS_FILE = Path(__file__).parent / "sessions.json"
CHECK_INTERVAL = 1  # секунды между проверками таймеров

# ---------- Хранение таймеров ----------


def load_timers() -> list:
    """Загружает таймеры из файла."""
    if TIMERS_FILE.exists():
        with open(TIMERS_FILE, "r") as f:
            return json.load(f)
    return []


def save_timers(timers: list):
    """Сохраняет таймеры в файл."""
    with open(TIMERS_FILE, "w") as f:
        json.dump(timers, f, indent=2)


def get_current_session_id() -> str:
    """Получает текущий session ID из sessions.json."""
    try:
        with open(SESSIONS_FILE, "r") as f:
            data = json.load(f)
        sessions = data.get("sessions", {})
        # Возвращаем первую сессию (у пользователя одна)
        return next(iter(sessions.values()), "")
    except Exception:
        return ""


async def send_prompt_to_opencode(message: str):
    """Отправляет промпт в OpenCode API."""
    session_id = get_current_session_id()
    if not session_id:
        print(f"[timer] ERROR: no session found in {SESSIONS_FILE}", file=sys.stderr)
        return

    url = f"{OPENCODE_URL}/session/{session_id}/prompt_async"
    payload = {"parts": [{"type": "text", "text": message}]}

    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(url, json=payload, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                if resp.status == 204:
                    print(f"[timer] OK: sent reminder to session {session_id}", file=sys.stderr)
                else:
                    print(f"[timer] ERROR: opencode returned {resp.status}", file=sys.stderr)
    except Exception as e:
        print(f"[timer] ERROR: failed to send prompt: {e}", file=sys.stderr)


# ---------- Фон. проверка таймеров ----------
timer_thread = None
stop_event = threading.Event()


def timer_checker():
    """Фон. поток: проверяет таймеры каждую секунду."""
    global stop_event
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    while not stop_event.is_set():
        timers = load_timers()
        now = time.time()
        expired = []
        active = []

        for t in timers:
            if now >= t["trigger_at"]:
                expired.append(t)
            else:
                active.append(t)

        if expired:
            save_timers(active)
            for t in expired:
                msg = f"⏰ TIMER ({t['id']}): {t['message']}"
                loop.run_until_complete(send_prompt_to_opencode(msg))

        if not stop_event.wait(CHECK_INTERVAL):
            continue

    loop.close()


def start_timer_thread():
    """Запускает фон. поток проверки таймеров."""
    global timer_thread, stop_event
    stop_event = threading.Event()
    timer_thread = threading.Thread(target=timer_checker, daemon=True)
    timer_thread.start()
    print("[timer] Timer checker thread started", file=sys.stderr)


def stop_timer_thread():
    """Останавливает фон. поток."""
    if timer_thread:
        stop_event.set()
        timer_thread.join(timeout=3)
        print("[timer] Timer checker thread stopped", file=sys.stderr)


# ---------- Инструменты ----------
TOOLS = [
    {
        "name": "set_timer",
        "description": "Поставить таймер. Через указанное количество минут будет отправлено напоминание в текущую сессию.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "minutes": {
                    "type": "number",
                    "description": "Через сколько минут сработать (min 0.1)"
                },
                "message": {
                    "type": "string",
                    "description": "Текст напоминания"
                }
            },
            "required": ["minutes", "message"]
        }
    },
    {
        "name": "cancel_timer",
        "description": "Отменить таймер по ID.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "timer_id": {
                    "type": "string",
                    "description": "ID таймера для отмены"
                }
            },
            "required": ["timer_id"]
        }
    },
    {
        "name": "list_timers",
        "description": "Показать все активные таймеры.",
        "inputSchema": {
            "type": "object",
            "properties": {}
        }
    }
]


def handle_set_timer(args: dict) -> dict:
    """Создаёт новый таймер."""
    minutes = args["minutes"]
    message = args["message"]

    if minutes < 0.1:
        return {"content": [{"type": "text", "text": "Минимум 0.1 минуты (6 секунд)"}]}

    import uuid
    timer_id = f"tmr_{uuid.uuid4().hex[:8]}"
    trigger_at = time.time() + minutes * 60

    timers = load_timers()
    timers.append({
        "id": timer_id,
        "message": message,
        "trigger_at": trigger_at,
        "created_at": datetime.now(timezone.utc).isoformat()
    })
    save_timers(timers)

    trigger_time = datetime.fromtimestamp(trigger_at, tz=timezone.utc).strftime("%H:%M:%S UTC")
    return {
        "content": [{"type": "text", "text": (
            f"Таймер установлен:\n"
            f"  ID: {timer_id}\n"
            f"  Через: {minutes} мин\n"
            f"  Срабатывание: {trigger_time}\n"
            f"  Сообщение: {message}"
        )}]
    }


def handle_cancel_timer(args: dict) -> dict:
    """Отменяет таймер."""
    timer_id = args["timer_id"]
    timers = load_timers()
    active = [t for t in timers if t["id"] != timer_id]

    if len(active) == len(timers):
        return {"content": [{"type": "text", "text": f"Таймер {timer_id} не найден"}]}

    save_timers(active)
    return {"content": [{"type": "text", "text": f"Таймер {timer_id} отменён"}]}


def handle_list_timers(args: dict) -> dict:
    """Показывает активные таймеры."""
    timers = load_timers()
    now = time.time()

    if not timers:
        return {"content": [{"type": "text", "text": "Нет активных таймеров"}]}

    lines = ["Активные таймеры:"]
    for t in timers:
        remaining = max(0, t["trigger_at"] - now)
        mins = int(remaining // 60)
        secs = int(remaining % 60)
        trigger_str = datetime.fromtimestamp(t["trigger_at"], tz=timezone.utc).strftime("%H:%M:%S UTC")
        lines.append(f"  [{t['id']}] {trigger_str} (осталось {mins}м {secs}с): {t['message']}")

    return {"content": [{"type": "text", "text": "\n".join(lines)}]}


HANDLERS = {
    "set_timer": handle_set_timer,
    "cancel_timer": handle_cancel_timer,
    "list_timers": handle_list_timers,
}

# ---------- MCP JSON-RPC ----------


async def process_request(request: dict) -> dict:
    """Обрабатывает JSON-RPC запрос."""
    method = request.get("method", "")
    params = request.get("params", {})
    request_id = request.get("id")

    if method == "initialize":
        return {
            "jsonrpc": "2.0",
            "id": request_id,
            "result": {
                "protocolVersion": "2024-11-05",
                "capabilities": {
                    "tools": {}
                },
                "serverInfo": {
                    "name": "timer-mcp-server",
                    "version": "1.0.0"
                }
            }
        }

    if method == "initialized":
        return {"jsonrpc": "2.0", "id": request_id, "result": {}}

    if method == "tools/list":
        return {
            "jsonrpc": "2.0",
            "id": request_id,
            "result": {"tools": TOOLS}
        }

    if method == "tools/call":
        tool_name = params.get("name", "")
        tool_args = params.get("arguments", {})
        handler = HANDLERS.get(tool_name)

        if not handler:
            return {
                "jsonrpc": "2.0",
                "id": request_id,
                "error": {
                    "code": -32601,
                    "message": f"Unknown tool: {tool_name}"
                }
            }

        try:
            result = handler(tool_args)
            return {
                "jsonrpc": "2.0",
                "id": request_id,
                "result": result
            }
        except Exception as e:
            return {
                "jsonrpc": "2.0",
                "id": request_id,
                "error": {
                    "code": -32603,
                    "message": str(e)
                }
            }

    return {
        "jsonrpc": "2.0",
        "id": request_id,
        "error": {
            "code": -32601,
            "message": f"Unknown method: {method}"
        }
    }


async def main():
    print("[timer] MCP Timer Server starting...", file=sys.stderr)
    start_timer_thread()

    reader = asyncio.StreamReader()
    protocol = asyncio.StreamReaderProtocol(reader)
    await asyncio.get_event_loop().connect_read_pipe(lambda: protocol, sys.stdin)

    stdout_writer = await asyncio.get_event_loop().connect_write_pipe(sys.stdout)

    buffer = ""
    while True:
        try:
            line = await reader.readline()
            if not line:
                break
            buffer += line
            if line.strip() == "":
                buffer = ""
                continue

            line_str = line.strip()
            if not line_str:
                continue

            try:
                request = json.loads(line_str)
                response = await process_request(request)
                response_str = json.dumps(response)
                stdout_writer.write(f"{response_str}\n".encode())
                await stdout_writer.drain()
            except json.JSONDecodeError as e:
                print(f"[timer] JSON error: {e}", file=sys.stderr)

        except (BrokenPipeError, ConnectionResetError):
            break

    stop_timer_thread()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        stop_timer_thread()
