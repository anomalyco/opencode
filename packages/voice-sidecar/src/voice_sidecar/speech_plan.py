"""Summarize the next speakable chunk of a long assistant reply."""

from __future__ import annotations

from .speech_summary import looks_like_long_form, split_sentences, strip_markdown_inline, voice_summary
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


def closing_unspoken(closing: str | None, spoken: str) -> bool:
    if not closing:
        return False
    cleaned = strip_markdown_inline(closing.rstrip("?")).strip().lower()
    if len(cleaned) < 4:
        return closing.lower() not in spoken.lower()
    hay = strip_markdown_inline(spoken).lower()
    return cleaned not in hay


def _finalize_continuation(result: dict[str, object], full: str, spoken: str) -> dict[str, object]:
    if not result.get("done"):
        return result
    closing = extract_closing_question(full)
    if not closing_unspoken(closing, spoken):
        return result
    chunk = str(result.get("chunk") or "").strip()
    if chunk:
        return {**result, "closingQuestion": closing}
    return {**result, "chunk": closing, "closingQuestion": closing}


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
            return _finalize_continuation({"chunk": "", "done": True}, full, spoken)
        if chunk:
            result: dict[str, object] = {"chunk": chunk, "done": done}
            if not done:
                result["offer"] = pick_offer_phrase()
            return _finalize_continuation(result, full, spoken)
    except ChatError:
        pass

    fallback = _fallback_chunk(full, spoken)
    if not fallback.get("done"):
        fallback["offer"] = pick_offer_phrase()
    return _finalize_continuation(fallback, full, spoken)


def extract_closing_question(text: str) -> str | None:
    stripped = text.strip()
    if not stripped:
        return None
    flattened = strip_markdown_inline(stripped.replace("\n", " "))
    idx = flattened.rfind("?")
    if idx == -1:
        return None
    start = max(flattened.rfind(".", 0, idx), flattened.rfind("!", 0, idx), -1)
    candidate = flattened[start + 1 : idx + 1].strip()
    if len(candidate) >= 3:
        return candidate
    lines = [strip_markdown_inline(line.strip()) for line in stripped.splitlines() if line.strip()]
    for line in reversed(lines):
        if line.endswith("?"):
            return line
    return None


def build_action_offer(closing: str) -> str:
    body = closing.rstrip("?").strip()
    lower = body.lower()
    for prefix in ("want me to ", "should i ", "would you like me to ", "do you want me to "):
        if lower.startswith(prefix):
            body = body[len(prefix) :].strip()
            break
    if not body:
        body = closing.rstrip("?").strip()
    return f"Want me to read more, or go ahead and {body[0].lower() + body[1:] if body else body}?"


def plan_final_speech(text: str) -> dict[str, object]:
    full = text.strip()
    gist = voice_summary(full)
    if not gist:
        return {"parts": [], "hasOffer": False, "fullText": full, "closingQuestion": None, "actionOffer": False}

    parts = [gist]
    has_offer = looks_like_long_form(full) or len(full.strip()) > len(gist.strip()) + 15
    closing = extract_closing_question(full) if has_offer else None
    if has_offer:
        parts.append(build_action_offer(closing) if closing else pick_offer_phrase())
    return {
        "parts": parts,
        "hasOffer": has_offer,
        "fullText": full,
        "closingQuestion": closing,
        "actionOffer": bool(closing),
    }
