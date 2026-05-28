from enum import Enum


class EventSessionUpdatedType(str, Enum):
    SESSION_UPDATED = "session.updated"

    def __str__(self) -> str:
        return str(self.value)
