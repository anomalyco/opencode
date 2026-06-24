"""Mid-turn speech intent classification."""

from __future__ import annotations

from .status_speech import build_status_speech
from .voice_phrases import DECLINE_ACK
from .xai_chat import ChatError, chat_complete, parse_json_object

_DECIDER_SYSTEM = """You classify short user utterances during a voice assistant session.

Phases:
- listening: idle, waiting for a new command
- working: the agent is busy on a task
- speaking: the assistant is reading a reply aloud
- awaiting_reply: the assistant asked if the user wants more detail

Intents:
- command: a normal new request (only when phase is listening)
- stop: user wants speech to stop (e.g. stop, quiet, enough, hold on)
- status: user asks what is happening or for progress
- redirect: user starts a different new task while the agent is busy
- reply: short yes/no answer to a pending detail offer (only when phase is awaiting_reply)

When intent is reply, also set reply to "yes" or "no".

Return JSON only, for example:
{"intent":"status"}
{"intent":"reply","reply":"yes"}
"""


def _heuristic_decide(text: str, phase: str, pending_offer: bool) -> dict[str, object]:
    lowered = text.strip().lower()
    if phase == "awaiting_reply" and pending_offer:
        if lowered in {"yes", "yeah", "yep", "sure", "please", "ok", "okay", "go ahead", "more"}:
            return {"intent": "reply", "reply": "yes"}
        if lowered in {"no", "nope", "nah", "enough", "stop", "that's fine", "that is fine", "i'm good", "im good"}:
            return {"intent": "reply", "reply": "no", "speak": DECLINE_ACK}
    if any(word in lowered for word in ("stop", "quiet", "enough", "hold on", "wait")):
        return {"intent": "stop"}
    if any(
        phrase in lowered
        for phrase in ("what's going on", "whats going on", "status", "progress", "what are you doing", "still working")
    ):
        return {"intent": "status"}
    if phase in {"working", "speaking", "awaiting_reply"}:
        return {"intent": "redirect"}
    return {"intent": "command"}


def decide_speech(
    *,
    text: str,
    phase: str,
    pending_offer: bool = False,
    last_spoken: str = "",
    progress: dict[str, object] | None = None,
) -> dict[str, object]:
    stripped = text.strip()
    if not stripped:
        return {"intent": "command"}

    if phase == "listening":
        return {"intent": "command"}

    user = (
        f"phase={phase}\n"
        f"pendingOffer={pending_offer}\n"
        f"lastSpoken={last_spoken[:400]}\n"
        f"userSpeech={stripped}"
    )

    try:
        raw = chat_complete(system=_DECIDER_SYSTEM, user=user, max_tokens=48)
        payload = parse_json_object(raw)
        intent = str(payload.get("intent") or "").strip().lower()
        if intent not in {"stop", "status", "redirect", "reply", "command"}:
            raise ChatError(f"unknown intent {intent!r}")
        result: dict[str, object] = {"intent": intent}
        reply = payload.get("reply")
        if isinstance(reply, str) and reply.strip().lower() in {"yes", "no"}:
            result["reply"] = reply.strip().lower()
    except ChatError:
        result = _heuristic_decide(stripped, phase, pending_offer)

    intent = str(result.get("intent") or "command")
    if intent == "status":
        result["speak"] = build_status_speech(progress)
    if intent == "reply" and result.get("reply") == "no":
        result["speak"] = DECLINE_ACK
    return result
