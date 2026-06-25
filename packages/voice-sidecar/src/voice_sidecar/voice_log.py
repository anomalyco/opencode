"""Append client-side voice debug lines to a local log file."""

from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path


def voice_web_log_path() -> Path:
    state = os.environ.get("XDG_STATE_HOME")
    root = Path(state) if state else Path.home() / ".local" / "state"
    directory = root / "opencode"
    directory.mkdir(parents=True, exist_ok=True)
    return directory / "voice-web.log"


def ensure_voice_web_log() -> Path:
    path = voice_web_log_path()
    path.touch(exist_ok=True)
    return path


def append_voice_web_log(lines: list[str]) -> Path:
    path = voice_web_log_path()
    with path.open("a", encoding="utf-8") as handle:
        for line in lines:
            text = str(line).strip()
            if text:
                handle.write(f"{text}\n")
    return path


def web_voice_log_line(stage: str, message: str) -> None:
    now = datetime.now(timezone.utc)
    ts = now.strftime("%H:%M:%S.") + f"{now.microsecond // 1000:03d}"
    append_voice_web_log([f"{ts} [{stage}] {message}"])
