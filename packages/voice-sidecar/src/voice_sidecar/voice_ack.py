"""When to play a working ack during agent turns."""

from __future__ import annotations

import re

from .voice_phrases import next_ack_phrase

_QUICK_QUERY_PATTERNS = (
    re.compile(r"^(hi|hello|hey|yo|sup|thanks|thank you|ok|okay|yes|no|nope)\b", re.I),
    re.compile(r"\b(can you hear me|are you there|you there|do you hear me|can you hear)\b", re.I),
    re.compile(r"^(what'?s up|how are you)\??$", re.I),
)

_TASK_VERBS = (
    "fix",
    "refactor",
    "build",
    "run",
    "find",
    "search",
    "commit",
    "deploy",
    "write",
    "create",
    "update",
    "debug",
    "implement",
    "add",
    "remove",
    "change",
    "install",
    "migrate",
    "test",
    "review",
    "explain",
    "summarize",
    "analyze",
    "open",
    "delete",
    "move",
    "rename",
    "configure",
    "setup",
    "set up",
)

_QUESTION_PREFIXES = ("what ", "how ", "why ", "when ", "where ", "which ", "who ", "what's ", "whats ")


def _has_tool_activity(progress: dict[str, object]) -> bool:
    reads = int(progress.get("reads") or 0)
    searches = int(progress.get("searches") or 0)
    lists = int(progress.get("lists") or 0)
    shell = int(progress.get("shell") or 0)
    return reads + searches + lists + shell > 0


def looks_like_quick_query(text: str) -> bool:
    stripped = text.strip()
    if not stripped:
        return True
    lowered = stripped.lower()
    for pattern in _QUICK_QUERY_PATTERNS:
        if pattern.search(lowered):
            return True
    words = lowered.split()
    if len(words) <= 3 and not any(verb in lowered for verb in _TASK_VERBS):
        return True
    return False


def looks_like_substantive_task(text: str) -> bool:
    lowered = text.strip().lower()
    if not lowered:
        return False
    if any(verb in lowered for verb in _TASK_VERBS):
        return True
    if len(lowered) > 60:
        return True
    if len(lowered) > 28 and lowered.startswith(_QUESTION_PREFIXES):
        return True
    return False


def should_play_ack(text: str, progress: dict[str, object] | None = None) -> bool:
    stripped = text.strip()
    if not stripped:
        return False
    snapshot = progress or {}
    if _has_tool_activity(snapshot):
        return True
    if looks_like_quick_query(stripped):
        return False
    return looks_like_substantive_task(stripped)


def ack_response(text: str, progress: dict[str, object] | None = None) -> dict[str, object]:
    if not should_play_ack(text, progress):
        return {"skip": True}
    return {"text": next_ack_phrase()}
