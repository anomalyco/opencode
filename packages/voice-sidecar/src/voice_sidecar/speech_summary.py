"""Spoken gist helpers — full reply stays on screen."""

from __future__ import annotations


def strip_markdown_inline(text: str) -> str:
    return text.replace("**", "").replace("__", "").replace("`", "")


def split_sentences(text: str) -> list[str]:
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


def looks_like_long_form(text: str) -> bool:
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


def voice_summary(text: str, max_chars: int = 260) -> str:
    stripped = text.strip()
    if not stripped:
        return ""
    if len(stripped) <= 120 and not looks_like_long_form(stripped):
        return stripped

    tail = " Details are on screen."
    paragraphs = [part.strip() for part in stripped.split("\n\n") if part.strip()]
    first = paragraphs[0] if paragraphs else stripped
    first_line = first.split("\n", 1)[0].strip()
    candidate = strip_markdown_inline(first_line if len(first_line) < len(first) else first.replace("\n", " "))

    sentences = split_sentences(candidate)
    gist = sentences[0] if sentences else candidate
    if len(gist) > max_chars:
        gist = gist[:max_chars].rsplit(" ", 1)[0].rstrip(".,;:-—")

    if looks_like_long_form(stripped) or len(stripped) > len(gist) + 40:
        gist = gist.rstrip(".,;:-—") + "." + tail
    return gist


def speak_text(text: str) -> str:
    return voice_summary(text)
