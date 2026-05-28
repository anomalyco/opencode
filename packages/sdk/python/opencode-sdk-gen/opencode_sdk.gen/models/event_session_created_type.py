from enum import Enum


class EventSessionCreatedType(str, Enum):
    SESSION_CREATED = "session.created"

    def __str__(self) -> str:
        return str(self.value)
