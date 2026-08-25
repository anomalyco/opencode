"""Content cleaning.

Conservative, non-destructive text normalization only. This module never
rewrites, summarizes, translates, or otherwise alters the *meaning* of
extracted content -- it only collapses whitespace and drops empty/duplicate
fragments (spec section 11).
"""

from __future__ import annotations

import re

_WHITESPACE_RE = re.compile(r"[ \t\f\v]+")
_BLANK_LINES_RE = re.compile(r"\n{3,}")


def clean_whitespace(text: str) -> str:
    """Collapse repeated horizontal whitespace and excessive blank lines."""
    if not text:
        return ""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = _WHITESPACE_RE.sub(" ", text)
    lines = [line.strip() for line in text.split("\n")]
    text = "\n".join(lines)
    text = _BLANK_LINES_RE.sub("\n\n", text)
    return text.strip()


def dedupe_preserve_order(items: list[str]) -> list[str]:
    """Remove exact-duplicate strings while preserving first-seen order."""
    seen: set[str] = set()
    result: list[str] = []
    for item in items:
        key = item.strip()
        if not key or key in seen:
            continue
        seen.add(key)
        result.append(item.strip())
    return result


def clean_paragraphs(paragraphs: list[str]) -> list[str]:
    """Clean a list of paragraph strings: strip whitespace, drop empties/dupes."""
    cleaned = [clean_whitespace(p) for p in paragraphs]
    cleaned = [p for p in cleaned if p]
    return dedupe_preserve_order(cleaned)


def clean_text_block(text: str) -> str:
    """Clean a large block of main/visible text."""
    return clean_whitespace(text)
