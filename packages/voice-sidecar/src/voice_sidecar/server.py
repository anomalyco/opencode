"""Phase 2 voice service — HTTP/WSS API skeleton.

Browser and test clients talk to the sidecar here. The opencode control plane stays
on the existing HTTP client in ``opencode.py``.
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
from pathlib import Path

from starlette.applications import Starlette
from starlette.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import FileResponse, JSONResponse
from starlette.routing import Route, WebSocketRoute
from starlette.websockets import WebSocket

from . import __version__
from .opencode import OpencodeClient, OpencodeError, discover_server
from .sessions import store
from .stream import require_xai_api_key
from .stt import STTError
from .tts import TTSError, default_tts
from .tui_turn import ensure_opencode_reachable, run_tui_turn
from .decider import decide_speech
from .speech_plan import next_continuation_chunk, plan_final_speech
from .voice_ack import ack_response
from .voice_stream import _speak_text, handle_voice_stream

_STATIC_DIR = Path(__file__).resolve().parent / "static"


def _stream_url(request: Request, voice_id: str) -> str:
    base = str(request.base_url).rstrip("/")
    ws_base = base.replace("https://", "wss://").replace("http://", "ws://")
    return f"{ws_base}/voice/session/{voice_id}/stream"


def _resolve_opencode_url(server: object | None) -> str:
    if isinstance(server, str) and server and "opencode.internal" not in server:
        return server
    return discover_server()[0]


async def health(_request: Request) -> JSONResponse:
    opencode_url, _password = discover_server()
    opencode: dict[str, object] = {"url": opencode_url, "reachable": False}
    try:
        client = OpencodeClient(url=opencode_url)
        await asyncio.to_thread(client._request, "GET", "/global/health")
        opencode["reachable"] = True
    except OpencodeError as exc:
        opencode["error"] = str(exc)

    stt: dict[str, object] = {"provider": "xai"}
    try:
        require_xai_api_key()
        stt["configured"] = True
    except STTError as exc:
        stt["configured"] = False
        stt["error"] = str(exc)

    tts: dict[str, object] = {"provider": "xai"}
    try:
        default_tts()
        tts["configured"] = True
    except (STTError, TTSError) as exc:
        tts["configured"] = False
        tts["error"] = str(exc)

    return JSONResponse(
        {
            "status": "ok",
            "version": __version__,
            "opencode": opencode,
            "stt": stt,
            "tts": tts,
        }
    )


async def voice_config(_request: Request) -> JSONResponse:
    opencode_url, _password = discover_server()
    return JSONResponse(
        {
            "protocol": 1,
            "version": __version__,
            "opencode_url": opencode_url,
            "routes": {
                "health": "GET /health",
                "config": "GET /voice/config",
                "test": "GET /voice/test",
                "session": "POST /voice/session",
                "tui_turn": "POST /voice/tui/turn",
                "decide": "POST /voice/decide",
                "final_speak": "POST /voice/final-speak",
                "continuation": "POST /voice/continuation-chunk",
                "ack": "POST /voice/ack",
                "stream": "WSS /voice/session/{id}/stream",
            },
            "auth": "stub — optional VOICE_SIDECAR_TOKEN (not enforced yet)",
        }
    )


async def create_voice_session(request: Request) -> JSONResponse:
    try:
        body = await request.json()
    except json.JSONDecodeError:
        return JSONResponse({"error": "request body must be JSON"}, status_code=400)
    if not isinstance(body, dict):
        return JSONResponse({"error": "request body must be a JSON object"}, status_code=400)

    directory = body.get("directory") or os.environ.get("OPENCODE_DIRECTORY")
    if not directory:
        return JSONResponse(
            {"error": "directory is required (JSON field or OPENCODE_DIRECTORY env)"},
            status_code=400,
        )
    directory = str(Path(directory).resolve())

    opencode_url = _resolve_opencode_url(body.get("server"))
    agent = body.get("agent") or os.environ.get("OPENCODE_AGENT")
    session_id = body.get("sessionID") or body.get("session_id")

    client = OpencodeClient(url=opencode_url, directory=directory)
    try:
        await asyncio.to_thread(client._request, "GET", "/global/health")
        if session_id:
            opencode_session_id = str(session_id)
        else:
            opencode_session_id = await asyncio.to_thread(client.create_session, agent)
    except OpencodeError as exc:
        return JSONResponse({"error": str(exc)}, status_code=502)

    composer = bool(body.get("composer"))
    terminal_mic = bool(body.get("terminalMic") or body.get("terminal_mic"))
    voice = store.create(
        opencode_url=client.url,
        opencode_session_id=opencode_session_id,
        directory=directory,
        agent=agent,
        composer=composer,
        terminal_mic=terminal_mic,
    )
    return JSONResponse(voice.to_dict(stream_url=_stream_url(request, voice.id)), status_code=201)


async def tui_voice_turn(request: Request) -> JSONResponse:
    try:
        body = await request.json()
    except json.JSONDecodeError:
        return JSONResponse({"error": "request body must be JSON"}, status_code=400)
    if not isinstance(body, dict):
        return JSONResponse({"error": "request body must be a JSON object"}, status_code=400)

    directory = body.get("directory") or os.environ.get("OPENCODE_DIRECTORY")
    if not directory:
        return JSONResponse(
            {"error": "directory is required (JSON field or OPENCODE_DIRECTORY env)"},
            status_code=400,
        )
    directory = str(Path(directory).resolve())

    session_id = body.get("sessionID") or body.get("session_id")
    if not session_id:
        return JSONResponse({"error": "sessionID is required"}, status_code=400)

    opencode_url = _resolve_opencode_url(body.get("server"))
    agent = body.get("agent") or os.environ.get("OPENCODE_AGENT")

    try:
        await ensure_opencode_reachable(opencode_url, directory)
        result = await run_tui_turn(
            opencode_url=str(opencode_url),
            directory=directory,
            session_id=str(session_id),
            agent=str(agent) if agent else None,
        )
    except OpencodeError as exc:
        return JSONResponse({"error": str(exc)}, status_code=502)
    except STTError as exc:
        return JSONResponse({"error": str(exc)}, status_code=502)
    except TTSError as exc:
        return JSONResponse({"error": str(exc)}, status_code=502)

    return JSONResponse(result)


async def voice_decide(request: Request) -> JSONResponse:
    try:
        body = await request.json()
    except json.JSONDecodeError:
        return JSONResponse({"error": "request body must be JSON"}, status_code=400)
    if not isinstance(body, dict):
        return JSONResponse({"error": "request body must be a JSON object"}, status_code=400)

    text = str(body.get("text") or "").strip()
    if not text:
        return JSONResponse({"error": "text is required"}, status_code=400)

    phase = str(body.get("phase") or "listening").strip().lower()
    progress = body.get("progress") if isinstance(body.get("progress"), dict) else None
    result = decide_speech(
        text=text,
        phase=phase,
        pending_offer=bool(body.get("pendingOffer")),
        last_spoken=str(body.get("lastSpoken") or ""),
        progress=progress,
    )
    return JSONResponse(result)


async def voice_final_speak(request: Request) -> JSONResponse:
    try:
        body = await request.json()
    except json.JSONDecodeError:
        return JSONResponse({"error": "request body must be JSON"}, status_code=400)
    if not isinstance(body, dict):
        return JSONResponse({"error": "request body must be a JSON object"}, status_code=400)

    text = str(body.get("text") or "").strip()
    if not text:
        return JSONResponse({"error": "text is required"}, status_code=400)
    return JSONResponse(plan_final_speech(text))


async def voice_continuation_chunk(request: Request) -> JSONResponse:
    try:
        body = await request.json()
    except json.JSONDecodeError:
        return JSONResponse({"error": "request body must be JSON"}, status_code=400)
    if not isinstance(body, dict):
        return JSONResponse({"error": "request body must be a JSON object"}, status_code=400)

    full_text = str(body.get("fullText") or body.get("text") or "").strip()
    spoken = str(body.get("spokenSoFar") or body.get("spoken") or "").strip()
    if not full_text:
        return JSONResponse({"error": "fullText is required"}, status_code=400)
    return JSONResponse(next_continuation_chunk(full_text=full_text, spoken_so_far=spoken))


async def voice_ack(request: Request) -> JSONResponse:
    body: dict[str, object] = {}
    try:
        raw = await request.body()
        if raw:
            parsed = await request.json()
            if isinstance(parsed, dict):
                body = parsed
    except json.JSONDecodeError:
        body = {}
    text = str(body.get("text") or "").strip()
    progress = body.get("progress") if isinstance(body.get("progress"), dict) else None
    return JSONResponse(ack_response(text, progress))


async def voice_speak(request: Request) -> JSONResponse:
    try:
        body = await request.json()
    except json.JSONDecodeError:
        return JSONResponse({"error": "request body must be JSON"}, status_code=400)
    if not isinstance(body, dict):
        return JSONResponse({"error": "request body must be a JSON object"}, status_code=400)

    text = str(body.get("text") or "").strip()
    if not text:
        return JSONResponse({"error": "text is required"}, status_code=400)

    raw = bool(body.get("raw"))
    speak = text if raw else _speak_text(text)
    if not speak:
        return JSONResponse({"error": "nothing to speak"}, status_code=400)

    tts = default_tts()
    try:
        audio = await asyncio.to_thread(tts.synthesize, speak)
    except TTSError as exc:
        return JSONResponse({"error": str(exc)}, status_code=502)
    if not audio:
        return JSONResponse({"error": "synthesis returned empty audio"}, status_code=502)

    return JSONResponse(
        {
            "text": speak,
            "format": "mp3",
            "encoding": "base64",
            "data": base64.b64encode(audio).decode("ascii"),
        }
    )


async def get_voice_session(request: Request) -> JSONResponse:
    voice = store.get(request.path_params["voice_id"])
    if not voice:
        return JSONResponse({"error": "voice session not found"}, status_code=404)
    return JSONResponse(voice.to_dict(stream_url=_stream_url(request, voice.id)))


async def voice_stream_ws(websocket: WebSocket) -> None:
    voice = store.get(websocket.path_params["voice_id"])
    if not voice:
        await websocket.accept()
        await websocket.close(code=4404, reason="voice session not found")
        return
    await handle_voice_stream(websocket, voice)


async def voice_test_page(_request: Request) -> FileResponse:
    path = _STATIC_DIR / "voice-test.html"
    return FileResponse(path)


def create_app() -> Starlette:
    app = Starlette(
        routes=[
            Route("/health", health, methods=["GET"]),
            Route("/voice/config", voice_config, methods=["GET"]),
            Route("/voice/test", voice_test_page, methods=["GET"]),
            Route("/voice/session", create_voice_session, methods=["POST"]),
            Route("/voice/tui/turn", tui_voice_turn, methods=["POST"]),
            Route("/voice/decide", voice_decide, methods=["POST"]),
            Route("/voice/final-speak", voice_final_speak, methods=["POST"]),
            Route("/voice/continuation-chunk", voice_continuation_chunk, methods=["POST"]),
            Route("/voice/ack", voice_ack, methods=["POST"]),
            Route("/voice/speak", voice_speak, methods=["POST"]),
            Route("/voice/session/{voice_id}", get_voice_session, methods=["GET"]),
            WebSocketRoute("/voice/session/{voice_id}/stream", voice_stream_ws),
        ],
    )
    # Local dev: web app on another origin will call the sidecar directly.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=os.environ.get("VOICE_CORS_ORIGINS", "*").split(","),
        allow_methods=["*"],
        allow_headers=["*"],
    )
    return app
