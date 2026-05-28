from enum import Enum


class EventSessionErrorType(str, Enum):
    SESSION_ERROR = "session.error"

    def __str__(self) -> str:
        return str(self.value)
