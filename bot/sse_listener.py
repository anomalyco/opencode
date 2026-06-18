"""
SSE клиент для OpenCode Event API.
Подключается к /api/event, разбирает поток и диспатчит события по типам.
"""
import asyncio
import json
from typing import Awaitable, Callable, Optional

import aiohttp
from aiohttp import ClientTimeout

from logging_config import logger


SSE_TIMEOUT = ClientTimeout(total=None, sock_read=360)


class SSEEventListener:
    """Асинхронный SSE клиент для OpenCode events."""

    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")
        self._task: Optional[asyncio.Task] = None
        self.running = False
        self.processed_events: set[str] = set()
        self._callbacks: dict[str, list[Callable[[dict], Awaitable[None]]]] = {}

    def on(self, event_type: str, callback: Callable[[dict], Awaitable[None]]):
        self._callbacks.setdefault(event_type, []).append(callback)

    def on_any(self, callback: Callable[[str, dict], Awaitable[None]]):
        self._callbacks.setdefault("*", []).append(callback)

    async def start(self):
        self.running = True
        self._task = asyncio.create_task(self._run())
        self._task.set_name("sse_listener")

    async def stop(self):
        self.running = False
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass

    async def _run(self):
        url = f"{self.base_url}/api/event"
        while self.running:
            try:
                async with aiohttp.ClientSession(timeout=SSE_TIMEOUT) as session:
                    async with session.get(url) as resp:
                        logger.info(f"SSE connected: {url}")
                        buf = ""
                        async for raw_chunk in resp.content.iter_any():
                            if not self.running:
                                break
                            buf += raw_chunk.decode("utf-8", errors="replace")
                            while "\n\n" in buf:
                                event_text, buf = buf.split("\n\n", 1)
                                data_lines = [
                                    l[6:] for l in event_text.split("\n") if l.startswith("data: ")
                                ]
                                if data_lines:
                                    await self._dispatch("".join(data_lines))
            except asyncio.CancelledError:
                break
            except (aiohttp.ClientError, asyncio.TimeoutError, OSError) as e:
                if self.running:
                    logger.warning(f"SSE connection error: {e}. Reconnecting in 5s...")
                    await asyncio.sleep(5)
            except Exception as e:
                logger.exception(f"SSE unexpected error: {e}")
                if self.running:
                    await asyncio.sleep(10)

    async def _dispatch(self, raw: str):
        try:
            event = json.loads(raw)
        except json.JSONDecodeError:
            logger.warning(f"SSE invalid JSON: {raw[:200]}")
            return

        event_id = event.get("id")
        event_type = event.get("type")
        event_data = event.get("data", {})

        if not event_id or not event_type:
            return

        if event_id in self.processed_events:
            return
        self.processed_events.add(event_id)

        for cb in self._callbacks.get(event_type, []):
            try:
                await cb(event_type, event_data)
            except Exception as e:
                logger.exception(f"SSE callback error for {event_type}: {e}")

        for cb in self._callbacks.get("*", []):
            try:
                await cb(event_type, event_data)
            except Exception as e:
                logger.exception(f"SSE wildcard callback error: {e}")
