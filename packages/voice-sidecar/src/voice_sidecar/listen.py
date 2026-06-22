"""Terminal microphone capture for one STT utterance."""

from __future__ import annotations

import asyncio

from .audio import SAMPLE_RATE
from .stream import XaiStreamingSTT, mic_frames
from .stt import STTError


async def listen_once_terminal(
    stt: XaiStreamingSTT,
    *,
    sample_rate: int = SAMPLE_RATE,
    device: int | None = None,
) -> str | None:
    for attempt in range(3):
        if attempt:
            await asyncio.sleep(0.5 * attempt)
        stop = asyncio.Event()
        captured: dict[str, str | None] = {"text": None}
        pending: dict[str, str | None] = {"text": None}
        finalize_task: asyncio.Task[None] | None = None
        loop = asyncio.get_running_loop()

        async def finalize_after(delay: float) -> None:
            await asyncio.sleep(delay)
            if stop.is_set() or not pending["text"]:
                return
            captured["text"] = pending["text"]
            stop.set()

        def on_event(event: dict) -> None:
            nonlocal finalize_task
            if event.get("type") != "transcript.partial":
                return
            text = event.get("text", "")
            if event.get("speech_final"):
                if finalize_task and not finalize_task.done():
                    finalize_task.cancel()
                captured["text"] = text
                stop.set()
                return
            if event.get("is_final") and text.strip():
                pending["text"] = text
                if finalize_task and not finalize_task.done():
                    finalize_task.cancel()
                finalize_task = loop.create_task(finalize_after(1.2))

        try:
            await stt.stream(mic_frames(sample_rate, device, stop), on_event)
        except STTError:
            if attempt < 2:
                continue
            raise
        if finalize_task and not finalize_task.done():
            finalize_task.cancel()
        text = captured["text"]
        if not text:
            return None
        stripped = text.strip()
        return stripped if stripped else None
    return None
