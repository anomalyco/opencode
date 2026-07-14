#!/usr/bin/env python3
"""PreToolUse guard: no stray docs.

Code self-documents (docstrings + types). The only durable markdown is CLAUDE.md /
STORIES.md / DEFERRED.md (plus a repo README and the skill files). Blocks creating any
OTHER markdown file — most importantly, a markdown file written to explain code.

Only guards Write (the file-creation vector). Editing files that already exist is
allowed (cleanup of legacy docs is a separate, manual concern). Scratch under
`workspace/` and skill docs under `.claude/` are allowed. Fails open on bad input.
"""

import json
import os
import sys

ALLOWED_BASENAMES = {
    "CLAUDE.md",
    "STORIES.md",
    "DEFERRED.md",
    "README.md",
    "AGENTS.md",
    "SKILL.md",
}


def main() -> int:
    try:
        data = json.load(sys.stdin)
    except Exception:
        return 0

    if data.get("tool_name") != "Write":
        return 0

    fp = (data.get("tool_input", {}) or {}).get("file_path", "")
    if not isinstance(fp, str) or not fp.endswith(".md"):
        return 0

    norm = fp.replace("\\", "/")
    if (
        norm.startswith("workspace/")
        or "/workspace/" in norm
        or norm.startswith(".claude/")
        or "/.claude/" in norm
    ):
        return 0
    if os.path.basename(fp) in ALLOWED_BASENAMES:
        return 0
    if os.path.exists(fp):  # editing an existing file, not creating a new doc
        return 0

    sys.stderr.write(
        "Blocked by guardrail: no stray docs. Behavior goes in STORIES.md, backlog in "
        "DEFERRED.md, conventions in CLAUDE.md. Code self-documents via docstrings and "
        "types — do not create a markdown file to explain code.\n"
        f"Refused: {fp}\n"
    )
    return 2


if __name__ == "__main__":
    sys.exit(main())
