from enum import Enum


class EventSessionDeletedType(str, Enum):
    SESSION_DELETED = "session.deleted"

    def __str__(self) -> str:
        return str(self.value)
