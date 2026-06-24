"""One voice turn for the TUI — local mic, opencode, TTS."""

from __future__ import annotations

import asyncio
import base64

from .listen import listen_once_terminal
from .opencode import OpencodeClient, OpencodeError
from .stream import XaiStreamingSTT
from .stt import STTError
from .tts import TTSError, default_tts
from .speech_summary import speak_text
from .speech_plan import plan_final_speech


async def run_tui_turn(
    *,
    opencode_url: str,
    directory: str,
    session_id: str,
    agent: str | None = None,
) -> dict[str, object]:
    stt = XaiStreamingSTT()
    tts = default_tts()
    client = OpencodeClient(url=opencode_url, directory=directory)

    text = await listen_once_terminal(stt)
    if not text:
        return {"status": "idle", "reason": "no speech"}

    reply = await asyncio.to_thread(
        lambda: client.run_turn(session_id, text, agent, log_model=False),
    )
    reply = reply or "(no reply)"
    plan = plan_final_speech(reply)
    parts = [str(part) for part in plan.get("parts") or [] if str(part).strip()]
    speak = " ".join(parts).strip() or speak_text(reply)

    payload: dict[str, object] = {
        "status": "ok",
        "transcript": text,
        "reply": reply,
        "speak": speak,
        "speakParts": parts,
        "hasOffer": bool(plan.get("hasOffer")),
    }

    if not speak:
        return payload

    try:
        audio = await asyncio.to_thread(tts.synthesize, speak)
    except TTSError as exc:
        payload["ttsError"] = str(exc)
        return payload

    if not audio:
        return payload

    payload["tts"] = {
        "format": "mp3",
        "encoding": "base64",
        "data": base64.b64encode(audio).decode("ascii"),
    }
    return payload


async def ensure_opencode_reachable(opencode_url: str, directory: str) -> None:
    client = OpencodeClient(url=opencode_url, directory=directory)
    await asyncio.to_thread(client._request, "GET", "/global/health")
