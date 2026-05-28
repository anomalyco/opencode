from enum import Enum


class EventSessionDiffType(str, Enum):
    SESSION_DIFF = "session.diff"

    def __str__(self) -> str:
        return str(self.value)
