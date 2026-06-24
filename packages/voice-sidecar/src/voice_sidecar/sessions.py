"""In-memory voice sessions — bind a browser stream to an opencode session."""

from __future__ import annotations

import secrets
import time
from dataclasses import dataclass


@dataclass
class VoiceSession:
    id: str
    opencode_url: str
    opencode_session_id: str
    directory: str
    agent: str | None
    composer: bool
    terminal_mic: bool
    created_at: float

    def to_dict(self, *, stream_url: str) -> dict:
        return {
            "id": self.id,
            "stream": stream_url,
            "opencode": {
                "url": self.opencode_url,
                "sessionID": self.opencode_session_id,
                "directory": self.directory,
                "agent": self.agent,
            },
            "createdAt": int(self.created_at * 1000),
        }


class VoiceSessionStore:
    def __init__(self) -> None:
        self._sessions: dict[str, VoiceSession] = {}

    def create(
        self,
        *,
        opencode_url: str,
        opencode_session_id: str,
        directory: str,
        agent: str | None,
        composer: bool = False,
        terminal_mic: bool = False,
    ) -> VoiceSession:
        session = VoiceSession(
            id=f"vs_{secrets.token_urlsafe(12)}",
            opencode_url=opencode_url,
            opencode_session_id=opencode_session_id,
            directory=directory,
            agent=agent,
            composer=composer,
            terminal_mic=terminal_mic,
            created_at=time.time(),
        )
        self._sessions[session.id] = session
        return session

    def get(self, voice_id: str) -> VoiceSession | None:
        return self._sessions.get(voice_id)


store = VoiceSessionStore()
