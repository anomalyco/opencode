"""Summarize the next speakable chunk of a long assistant reply."""

from __future__ import annotations

from .speech_summary import looks_like_long_form, strip_markdown_inline, voice_summary
from .voice_phrases import pick_offer_phrase
from .xai_chat import ChatError, chat_complete, parse_json_object

_CONTINUATION_SYSTEM = """You summarize the next short spoken chunk of an assistant reply for voice TTS.

Rules:
- Speak naturally in 1-3 sentences, under 220 characters when possible.
- Do not repeat what was already spoken.
- Skip markdown, code blocks, URLs, and file paths.
- If nothing meaningful remains, set done to true and chunk to empty string.
- Otherwise set done to false.

Return JSON only, for example:
{"chunk":"Next, the fix updates the prompt handler.","done":false}
"""


def _fallback_chunk(full_text: str, spoken_so_far: str) -> dict[str, object]:
    full = full_text.strip()
    spoken = spoken_so_far.strip()
    if not full:
        return {"chunk": "", "done": True}

    if not spoken:
        gist = voice_summary(full)
        remaining = full[len(gist) :].strip() if gist and full.startswith(gist[: min(len(gist), len(full))]) else full
        done = not remaining or not looks_like_long_form(full)
        return {"chunk": gist, "done": done}

    if spoken in full:
        start = full.find(spoken) + len(spoken)
        remaining = full[start:].strip()
    else:
        remaining = full

    if not remaining:
        return {"chunk": "", "done": True}

    cleaned = strip_markdown_inline(remaining.replace("\n", " "))
    chunk = cleaned[:220].rsplit(" ", 1)[0].strip() if len(cleaned) > 220 else cleaned
    if not chunk:
        return {"chunk": "", "done": True}
    if not chunk.endswith("."):
        chunk = chunk.rstrip(".,;:-—") + "."
    done = len(remaining) <= len(chunk) + 20
    return {"chunk": chunk, "done": done}


def next_continuation_chunk(*, full_text: str, spoken_so_far: str) -> dict[str, object]:
    full = full_text.strip()
    spoken = spoken_so_far.strip()
    if not full:
        return {"chunk": "", "done": True}

    user = f"alreadySpoken={spoken[:1200]}\nfullText={full[:12000]}"
    try:
        raw = chat_complete(system=_CONTINUATION_SYSTEM, user=user, max_tokens=160)
        payload = parse_json_object(raw)
        chunk = str(payload.get("chunk") or "").strip()
        done = bool(payload.get("done"))
        if not chunk and done:
            return {"chunk": "", "done": True}
        if chunk:
            return {"chunk": chunk, "done": done, "offer": pick_offer_phrase() if not done else None}
    except ChatError:
        pass

    fallback = _fallback_chunk(full, spoken)
    if fallback.get("done"):
        return fallback
    fallback["offer"] = pick_offer_phrase()
    return fallback


def plan_final_speech(text: str) -> dict[str, object]:
    full = text.strip()
    gist = voice_summary(full)
    if not gist:
        return {"parts": [], "hasOffer": False, "fullText": full}

    parts = [gist]
    has_offer = looks_like_long_form(full) or (full and len(full) > len(gist) + 40)
    if has_offer:
        parts.append(pick_offer_phrase())
    return {"parts": parts, "hasOffer": has_offer, "fullText": full}
