"""WSS voice stream — browser or terminal audio in, STT + opencode + TTS events out."""

from __future__ import annotations

import asyncio
import base64
import json
import sys
from typing import AsyncIterator, Callable

from starlette.websockets import WebSocket, WebSocketDisconnect, WebSocketState

from .opencode import OpencodeClient, OpencodeError
from .sessions import VoiceSession
from .speech_summary import speak_text
from .stt import STTError
from .stream import XaiStreamingSTT, mic_frames
from .tts import TTSError, default_tts

# Re-export for server imports that still reference this module.
_speak_text = speak_text


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


async def _poll_websocket_control(
    websocket: WebSocket,
    stop: asyncio.Event,
    on_speak: Callable[[str, bool], None] | None = None,
    accept_mic: asyncio.Event | None = None,
) -> None:
    while not stop.is_set():
        if websocket.client_state != WebSocketState.CONNECTED:
            return
        try:
            message = await asyncio.wait_for(websocket.receive(), timeout=0.2)
        except asyncio.TimeoutError:
            continue
        if message["type"] == "websocket.disconnect":
            stop.set()
            return
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
        if event.get("type") == "mic" and accept_mic is not None:
            enabled = event.get("enabled")
            if enabled is True:
                accept_mic.set()
                _log("terminal mic enabled")
            elif enabled is False:
                accept_mic.clear()
                _log("terminal mic disabled")
            continue
        if event.get("type") == "speak" and on_speak is not None:
            reply = str(event.get("text") or "")
            if reply.strip():
                on_speak(reply, bool(event.get("raw")))


async def _websocket_frames(
    websocket: WebSocket,
    stop: asyncio.Event,
    accept_audio: asyncio.Event,
    on_speak: Callable[[str, bool], None] | None = None,
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
        if event.get("type") == "speak" and on_speak is not None:
            reply = str(event.get("text") or "")
            if reply.strip():
                on_speak(reply, bool(event.get("raw")))
            continue


async def _speak_over_ws(
    websocket: WebSocket,
    tts,
    text: str,
    *,
    raw: bool = False,
    accept_mic: asyncio.Event | None = None,
    speak_lock: asyncio.Lock | None = None,
) -> None:
    async def run() -> None:
        summary = text.strip() if raw else speak_text(text)
        if not summary:
            _log("tts skipped: empty speak text after summary")
            await _send_json(websocket, {"type": "speak", "skipped": True})
            return
        await _send_json(websocket, {"type": "status", "state": "speaking"})
        try:
            audio = await asyncio.to_thread(tts.synthesize, summary)
        except TTSError as exc:
            _log(f"tts error: {exc}")
            await _send_json(websocket, {"type": "error", "message": str(exc)})
            await _send_json(websocket, {"type": "speak", "skipped": True})
            return
        if not audio:
            _log("tts skipped: synthesize returned empty audio")
            await _send_json(websocket, {"type": "speak", "skipped": True})
            return
        _log(f"tts ready: {len(summary)} chars → {len(audio)} bytes")
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

    if speak_lock is None:
        await run()
        return
    async with speak_lock:
        await run()


async def _listen_from_frames(
    websocket: WebSocket,
    stt: XaiStreamingSTT,
    stop: asyncio.Event,
    frames: AsyncIterator[bytes],
) -> str | None:
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
        await stt.stream(frames, on_event)
    finally:
        stop.set()
        forward_task.cancel()
        await asyncio.gather(forward_task, return_exceptions=True)
    text = captured["text"]
    if not text:
        return None
    stripped = text.strip()
    return stripped if stripped else None


async def _listen_once(
    websocket: WebSocket,
    stt: XaiStreamingSTT,
    accept_audio: asyncio.Event,
    on_speak: Callable[[str, bool], None] | None = None,
) -> str | None:
    for attempt in range(3):
        if attempt:
            await asyncio.sleep(0.5 * attempt)
            await _send_json(websocket, {"type": "status", "state": "listening", "retry": attempt + 1})
        accept_audio.set()
        stop = asyncio.Event()

        async def frames() -> AsyncIterator[bytes]:
            async for chunk in _websocket_frames(websocket, stop, accept_audio, on_speak):
                yield chunk

        try:
            text = await _listen_from_frames(websocket, stt, stop, frames())
        except STTError:
            accept_audio.clear()
            if attempt < 2:
                continue
            raise
        accept_audio.clear()
        if text:
            return text
    return None


async def _listen_once_terminal(
    websocket: WebSocket,
    stt: XaiStreamingSTT,
    accept_mic: asyncio.Event | None = None,
) -> str | None:
    for attempt in range(3):
        if attempt:
            await asyncio.sleep(0.5 * attempt)
            await _send_json(websocket, {"type": "status", "state": "listening", "retry": attempt + 1})
        stop = asyncio.Event()

        async def frames() -> AsyncIterator[bytes]:
            async for chunk in mic_frames(stt.sample_rate, None, stop):
                if accept_mic is not None and not accept_mic.is_set():
                    continue
                yield chunk

        try:
            text = await _listen_from_frames(websocket, stt, stop, frames())
        except STTError:
            stop.set()
            if attempt < 2:
                continue
            raise
        finally:
            stop.set()
        if text:
            return text
    return None


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
            "encoding": "pcm16" if not voice.terminal_mic else "terminal",
        },
    )

    accept_audio = asyncio.Event()
    accept_audio.set()
    accept_mic = asyncio.Event()
    if voice.terminal_mic:
        accept_mic.set()
    speak_lock = asyncio.Lock()

    def schedule_speak(text: str, raw: bool = False) -> None:
        asyncio.create_task(
            _speak_over_ws(
                websocket,
                tts,
                text,
                raw=raw,
                accept_mic=accept_mic if voice.terminal_mic else None,
                speak_lock=speak_lock if voice.terminal_mic else None,
            )
        )

    listen = (
        (lambda: _listen_once_terminal(websocket, stt, accept_mic))
        if voice.terminal_mic
        else (lambda: _listen_once(websocket, stt, accept_audio, schedule_speak))
    )

    session_stop = asyncio.Event()
    control_task: asyncio.Task[None] | None = None
    if voice.terminal_mic:
        control_task = asyncio.create_task(
            _poll_websocket_control(websocket, session_stop, schedule_speak, accept_mic),
        )

    try:
        while websocket.client_state == WebSocketState.CONNECTED:
            await _send_json(websocket, {"type": "status", "state": "listening"})
            try:
                text = await listen()
            except STTError as exc:
                await _send_json(websocket, {"type": "error", "message": str(exc)})
                continue
            if not text:
                if not voice.terminal_mic:
                    await _drain_websocket(websocket, seconds=0.15)
                await _send_json(websocket, {"type": "status", "state": "idle", "reason": "no speech"})
                continue

            if not voice.terminal_mic:
                await _drain_websocket(websocket, seconds=0.15)
                accept_audio.clear()
            await _send_json(websocket, {"type": "status", "state": "transcribing", "text": text})
            if voice.composer:
                await _send_json(websocket, {"type": "status", "state": "listening"})
                continue

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

            summary = speak_text(reply)
            if not summary:
                _log("tts skipped: empty speak text after summary")
                await _send_json(websocket, {"type": "status", "state": "listening"})
                continue

            await _send_json(websocket, {"type": "speak", "text": summary})
            await _send_json(websocket, {"type": "status", "state": "speaking"})
            try:
                audio = await asyncio.to_thread(tts.synthesize, summary)
            except TTSError as exc:
                _log(f"tts error: {exc}")
                await _send_json(websocket, {"type": "error", "message": str(exc)})
                continue
            if not audio:
                _log("tts skipped: synthesize returned empty audio")
                await _send_json(websocket, {"type": "status", "state": "listening"})
                continue
            _log(f"tts ready: {len(summary)} chars → {len(audio)} bytes")
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
    finally:
        session_stop.set()
        if control_task is not None:
            control_task.cancel()
            await asyncio.gather(control_task, return_exceptions=True)


async def handle_voice_stream(websocket: WebSocket, voice: VoiceSession) -> None:
    await websocket.accept()
    try:
        await run_voice_stream(websocket, voice)
    except WebSocketDisconnect:
        return
