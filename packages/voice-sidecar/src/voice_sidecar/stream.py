"""Live (streaming) speech-to-text over xAI's WebSocket API.

Protocol (https://docs.x.ai/developers/model-capabilities/audio/speech-to-text):
  - connect to wss://api.x.ai/v1/stt with config in query params + Bearer auth
  - wait for a ``transcript.created`` event, then stream raw PCM16 frames
  - server emits ``transcript.partial`` events:
      is_final=false, speech_final=false  → interim partial
      is_final=true,  speech_final=false  → chunk final (locked ~3s)
      is_final=true,  speech_final=true   → utterance final (speaker stopped)
  - send ``{"type":"audio.done"}`` to flush; server sends ``transcript.done`` & closes

The utterance-final (``speech_final``) is the unit that later phases hand to the
decider.
"""

from __future__ import annotations

import asyncio
import json
import os
from typing import AsyncIterator, Callable
from urllib.parse import urlencode

import websockets

from .audio import CHANNELS, SAMPLE_RATE
from .stt import STTError

EventHandler = Callable[[dict], None]

_PLACEHOLDER_KEYS = frozenset(
    {
        "…",
        "...",
        "xxx",
        "your-key",
        "your xai voice key",
        "your xai key",
        "<your-key>",
    }
)


def require_xai_api_key() -> str:
    """Return a trimmed ``XAI_API_KEY`` or raise ``STTError`` with a clear message."""
    key = os.environ.get("XAI_API_KEY", "").strip()
    if not key:
        raise STTError("XAI_API_KEY is not set")
    if key in _PLACEHOLDER_KEYS or key.lower() in _PLACEHOLDER_KEYS:
        raise STTError(
            "XAI_API_KEY looks like a placeholder — create a real key at https://console.x.ai"
        )
    if len(key) < 70:
        raise STTError(
            f"XAI_API_KEY looks truncated ({len(key)} chars) — copy the full key from https://console.x.ai"
        )
    return key


def _stt_connect_error(exc: websockets.InvalidStatus) -> STTError:
    response = exc.response
    detail = ""
    if response.body:
        try:
            payload = json.loads(response.body)
            detail = str(payload.get("error") or payload.get("message") or "").strip()
        except (json.JSONDecodeError, TypeError, UnicodeDecodeError):
            detail = response.body.decode(errors="replace").strip()[:200]
    if response.status_code == 401 or "incorrect api key" in detail.lower():
        return STTError(
            "xAI STT authentication failed — verify the full XAI_API_KEY at https://console.x.ai"
            + (f" ({detail})" if detail else "")
        )
    if detail:
        return STTError(f"xAI STT connection failed (HTTP {response.status_code}): {detail}")
    return STTError(f"WebSocket connection rejected: {exc}")


async def mic_frames(
    sample_rate: int,
    device: str | int | None,
    stop: asyncio.Event,
    block_ms: int = 100,
) -> AsyncIterator[bytes]:
    """Yield ~``block_ms`` chunks of raw PCM16 mic audio until ``stop`` is set."""
    import sounddevice as sd

    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[bytes] = asyncio.Queue()
    block = int(sample_rate * block_ms / 1000)

    def callback(indata, _frames, _time, status):  # runs on PortAudio thread
        loop.call_soon_threadsafe(queue.put_nowait, bytes(indata))

    with sd.InputStream(
        samplerate=sample_rate,
        channels=CHANNELS,
        dtype="int16",
        blocksize=block,
        device=device,
        callback=callback,
    ):
        while not stop.is_set():
            try:
                chunk = await asyncio.wait_for(queue.get(), timeout=0.2)
            except asyncio.TimeoutError:
                continue
            yield chunk


async def file_frames(path: str, block_ms: int = 100) -> AsyncIterator[bytes]:
    """Yield PCM16 chunks from a wav file, paced in real time (for testing)."""
    import wave

    with wave.open(path, "rb") as wf:
        sample_rate = wf.getframerate()
        frames_per_chunk = int(sample_rate * block_ms / 1000)
        while True:
            data = wf.readframes(frames_per_chunk)
            if not data:
                break
            yield data
            await asyncio.sleep(block_ms / 1000)


class XaiStreamingSTT:
    """Streaming transcription client for xAI's WebSocket STT."""

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
        language: str | None = None,
        sample_rate: int = SAMPLE_RATE,
        interim_results: bool = True,
    ) -> None:
        self.api_key = (api_key or require_xai_api_key()).strip()
        base = (base_url or os.environ.get("XAI_BASE_URL") or "https://api.x.ai/v1").rstrip("/")
        ws_base = base.replace("https://", "wss://").replace("http://", "ws://")
        self.language = language or os.environ.get("VOICE_STT_LANGUAGE") or "en"
        self.sample_rate = sample_rate
        query = urlencode(
            {
                "sample_rate": sample_rate,
                "encoding": "pcm",
                "interim_results": "true" if interim_results else "false",
                "language": self.language,
            }
        )
        self.url = f"{ws_base}/stt?{query}"

    async def check_auth(self) -> None:
        """Verify the API key by opening the STT WebSocket (no audio sent)."""
        headers = {"Authorization": f"Bearer {self.api_key}"}
        try:
            async with websockets.connect(
                self.url,
                additional_headers=headers,
                open_timeout=10,
                close_timeout=5,
            ) as ws:
                created = json.loads(await ws.recv())
                if created.get("type") != "transcript.created":
                    raise STTError(f"unexpected first message: {created}")
        except websockets.InvalidStatus as exc:
            raise _stt_connect_error(exc) from exc
        except OSError as exc:
            raise STTError(f"WebSocket connection failed: {exc}") from exc

    async def stream(self, frames: AsyncIterator[bytes], on_event: EventHandler) -> None:
        """Stream ``frames`` to the API, invoking ``on_event`` for each result.

        Returns when the server sends ``transcript.done`` (after the frame source
        is exhausted and ``audio.done`` is sent).
        """
        headers = {"Authorization": f"Bearer {self.api_key}"}
        try:
            async with websockets.connect(
                self.url,
                additional_headers=headers,
                open_timeout=10,
                close_timeout=5,
            ) as ws:
                created = json.loads(await ws.recv())
                if created.get("type") != "transcript.created":
                    raise STTError(f"unexpected first message: {created}")

                async def sender() -> None:
                    async for chunk in frames:
                        await ws.send(chunk)
                    await ws.send(json.dumps({"type": "audio.done"}))

                send_task = asyncio.create_task(sender())
                try:
                    async for message in ws:
                        if isinstance(message, (bytes, bytearray)):
                            continue
                        event = json.loads(message)
                        kind = event.get("type")
                        if kind == "error":
                            raise STTError(event.get("message", "stream error"))
                        on_event(event)
                        if kind == "transcript.done":
                            break
                finally:
                    send_task.cancel()
                    await asyncio.gather(send_task, return_exceptions=True)
        except websockets.InvalidStatus as exc:
            raise _stt_connect_error(exc) from exc
        except OSError as exc:
            raise STTError(f"WebSocket connection failed: {exc}") from exc
