from enum import Enum


class EventSessionCompactedType(str, Enum):
    SESSION_COMPACTED = "session.compacted"

    def __str__(self) -> str:
        return str(self.value)
