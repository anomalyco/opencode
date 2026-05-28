from enum import Enum


class EventSessionIdleType(str, Enum):
    SESSION_IDLE = "session.idle"

    def __str__(self) -> str:
        return str(self.value)
