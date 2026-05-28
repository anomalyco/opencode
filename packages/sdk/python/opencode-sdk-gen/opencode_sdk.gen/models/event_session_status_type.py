from enum import Enum


class EventSessionStatusType(str, Enum):
    SESSION_STATUS = "session.status"

    def __str__(self) -> str:
        return str(self.value)
