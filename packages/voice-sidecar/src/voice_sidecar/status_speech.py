"""Template status speech from a progress snapshot — swappable for LLM later."""

from __future__ import annotations


def _count_label(count: int, singular: str, plural: str) -> str:
    if count == 1:
        return f"1 {singular}"
    return f"{count} {plural}"


def build_status_speech(progress: dict[str, object] | None) -> str:
    if not progress:
        return "Still working on that."

    reads = int(progress.get("reads") or 0)
    searches = int(progress.get("searches") or 0)
    lists = int(progress.get("lists") or 0)
    shell = int(progress.get("shell") or 0)
    thinking = bool(progress.get("thinking"))

    parts: list[str] = []
    if thinking:
        parts.append("Still thinking.")

    explored: list[str] = []
    if reads:
        explored.append(_count_label(reads, "read", "reads"))
    if searches:
        explored.append(_count_label(searches, "search", "searches"))
    if lists:
        explored.append(_count_label(lists, "list", "lists"))
    if explored:
        parts.append("Explored " + ", ".join(explored) + ".")

    if shell == 1:
        parts.append("Ran 1 shell command so far.")
    elif shell:
        parts.append(f"Ran {shell} shell commands so far.")

    if not parts:
        return "Still working on that."
    return " ".join(parts)
