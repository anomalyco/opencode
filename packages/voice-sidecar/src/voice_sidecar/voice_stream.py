"""WSS voice stream — browser audio in, STT + opencode + TTS events out."""

from __future__ import annotations

import asyncio
import base64
import json
import sys
from typing import AsyncIterator

from starlette.websockets import WebSocket, WebSocketDisconnect, WebSocketState

from .opencode import OpencodeClient, OpencodeError
from .sessions import VoiceSession
from .stt import STTError
from .stream import XaiStreamingSTT
from .tts import TTSError, default_tts


def _log(msg: str) -> None:
    print(f"voice-sidecar: {msg}", file=sys.stderr, flush=True)


async def _send_json(websocket: WebSocket, payload: dict) -> None:
    if websocket.client_state != WebSocketState.CONNECTED:
        return
    await websocket.send_text(json.dumps(payload))


async def _drain_websocket(websocket: WebSocket, seconds: float = 0.3) -> None:
    """Drop buffered mic frames between turns so they are not transcribed as new utterances."""
    deadline = asyncio.get_running_loop().time() + seconds
    while asyncio.get_running_loop().time() < deadline:
        if websocket.client_state != WebSocketState.CONNECTED:
            return
        try:
            message = await asyncio.wait_for(websocket.receive(), timeout=0.05)
        except asyncio.TimeoutError:
            continue
        if message["type"] == "websocket.disconnect":
            return


async def _websocket_frames(
    websocket: WebSocket,
    stop: asyncio.Event,
    accept_audio: asyncio.Event,
) -> AsyncIterator[bytes]:
    while not stop.is_set():
        if websocket.client_state != WebSocketState.CONNECTED:
            return
        try:
            message = await asyncio.wait_for(websocket.receive(), timeout=0.2)
        except asyncio.TimeoutError:
            continue
        if message["type"] == "websocket.disconnect":
            return
        chunk = message.get("bytes")
        if chunk:
            if accept_audio.is_set():
                yield chunk
            continue
        text = message.get("text")
        if not text:
            continue
        try:
            event = json.loads(text)
        except json.JSONDecodeError:
            continue
        if event.get("type") == "audio.done":
            stop.set()
            return


async def _listen_once(
    websocket: WebSocket,
    stt: XaiStreamingSTT,
    accept_audio: asyncio.Event,
) -> str | None:
    for attempt in range(3):
        if attempt:
            await asyncio.sleep(0.5 * attempt)
            await _send_json(websocket, {"type": "status", "state": "listening", "retry": attempt + 1})
        accept_audio.set()
        stop = asyncio.Event()
        captured: dict[str, str | None] = {"text": None}
        loop = asyncio.get_running_loop()
        outbound: asyncio.Queue[dict] = asyncio.Queue()

        def on_event(event: dict) -> None:
            if event.get("type") != "transcript.partial":
                return
            text = event.get("text", "")
            speech_final = bool(event.get("speech_final"))
            is_final = bool(event.get("is_final"))
            loop.call_soon_threadsafe(
                outbound.put_nowait,
                {
                    "type": "transcript",
                    "text": text,
                    "final": is_final,
                    "speechFinal": speech_final,
                },
            )
            if not speech_final:
                return
            accept_audio.clear()
            captured["text"] = text
            stop.set()

        async def forward_events() -> None:
            while not stop.is_set() or not outbound.empty():
                try:
                    payload = await asyncio.wait_for(outbound.get(), timeout=0.2)
                except asyncio.TimeoutError:
                    if stop.is_set():
                        break
                    continue
                await _send_json(websocket, payload)

        forward_task = asyncio.create_task(forward_events())
        try:
            await stt.stream(_websocket_frames(websocket, stop, accept_audio), on_event)
        except STTError:
            if attempt < 2:
                continue
            raise
        finally:
            accept_audio.clear()
            stop.set()
            forward_task.cancel()
            await asyncio.gather(forward_task, return_exceptions=True)
        text = captured["text"]
        if not text:
            return None
        stripped = text.strip()
        return stripped if stripped else None
    return None


def _strip_markdown_inline(text: str) -> str:
    return text.replace("**", "").replace("__", "").replace("`", "")


def _split_sentences(text: str) -> list[str]:
    sentences: list[str] = []
    chunk = ""
    for char in text:
        chunk += char
        if char in ".!?" and len(chunk.strip()) > 15:
            sentences.append(chunk.strip())
            chunk = ""
    if chunk.strip():
        sentences.append(chunk.strip())
    return sentences


def _looks_like_long_form(text: str) -> bool:
    if len(text) > 300:
        return True
    if text.count("\n") >= 2:
        return True
    if "```" in text or "http://" in text or "https://" in text:
        return True
    if "packages/" in text:
        return True
    if sum(1 for line in text.splitlines() if line.strip().startswith(("-", "*", "•"))) >= 2:
        return True
    if text.count(": ") >= 3:
        return True
    return False


def _voice_summary(text: str, max_chars: int = 260) -> str:
    """Short spoken gist for TTS — full reply stays on screen (PRD §7)."""
    stripped = text.strip()
    if not stripped:
        return ""
    if len(stripped) <= 120 and not _looks_like_long_form(stripped):
        return stripped

    tail = " Details are on screen."
    paragraphs = [part.strip() for part in stripped.split("\n\n") if part.strip()]
    first = paragraphs[0] if paragraphs else stripped
    first_line = first.split("\n", 1)[0].strip()
    candidate = _strip_markdown_inline(first_line if len(first_line) < len(first) else first.replace("\n", " "))

    sentences = _split_sentences(candidate)
    gist = sentences[0] if sentences else candidate
    if len(gist) > max_chars:
        gist = gist[:max_chars].rsplit(" ", 1)[0].rstrip(".,;:-—")

    if _looks_like_long_form(stripped) or len(stripped) > len(gist) + 40:
        gist = gist.rstrip(".,;:-—") + "." + tail
    return gist


def _speak_text(text: str) -> str:
    return _voice_summary(text)


async def run_voice_stream(websocket: WebSocket, voice: VoiceSession) -> None:
    stt = XaiStreamingSTT()
    tts = default_tts()
    client = OpencodeClient(url=voice.opencode_url, directory=voice.directory)

    await _send_json(
        websocket,
        {
            "type": "ready",
            "voiceID": voice.id,
            "opencodeSessionID": voice.opencode_session_id,
            "sampleRate": stt.sample_rate,
            "encoding": "pcm16",
        },
    )

    accept_audio = asyncio.Event()
    accept_audio.set()

    while websocket.client_state == WebSocketState.CONNECTED:
        await _send_json(websocket, {"type": "status", "state": "listening"})
        try:
            text = await _listen_once(websocket, stt, accept_audio)
        except STTError as exc:
            await _send_json(websocket, {"type": "error", "message": str(exc)})
            continue
        if not text:
            await _drain_websocket(websocket, seconds=0.15)
            await _send_json(websocket, {"type": "status", "state": "idle", "reason": "no speech"})
            continue

        await _drain_websocket(websocket, seconds=0.15)

        accept_audio.clear()
        await _send_json(websocket, {"type": "status", "state": "transcribing", "text": text})
        await _send_json(websocket, {"type": "status", "state": "working"})
        try:
            reply = await asyncio.to_thread(
                lambda: client.run_turn(
                    voice.opencode_session_id,
                    text,
                    voice.agent,
                    log_model=False,
                )
            )
        except OpencodeError as exc:
            await _send_json(websocket, {"type": "error", "message": str(exc)})
            continue

        reply = reply or "(no reply)"
        await _send_json(websocket, {"type": "reply", "text": reply})

        speak = _speak_text(reply)
        if not speak:
            _log("tts skipped: empty speak text after summary")
            await _send_json(websocket, {"type": "status", "state": "listening"})
            continue

        await _send_json(websocket, {"type": "speak", "text": speak})
        await _send_json(websocket, {"type": "status", "state": "speaking"})
        try:
            audio = await asyncio.to_thread(tts.synthesize, speak)
        except TTSError as exc:
            _log(f"tts error: {exc}")
            await _send_json(websocket, {"type": "error", "message": str(exc)})
            continue
        if not audio:
            _log("tts skipped: synthesize returned empty audio")
            await _send_json(websocket, {"type": "status", "state": "listening"})
            continue
        _log(f"tts ready: {len(speak)} chars → {len(audio)} bytes")
        await _send_json(
            websocket,
            {
                "type": "tts",
                "format": "mp3",
                "encoding": "base64",
                "data": base64.b64encode(audio).decode("ascii"),
            },
        )
        await _send_json(websocket, {"type": "status", "state": "listening"})


async def handle_voice_stream(websocket: WebSocket, voice: VoiceSession) -> None:
    await websocket.accept()
    try:
        await run_voice_stream(websocket, voice)
    except WebSocketDisconnect:
        return
