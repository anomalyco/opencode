from enum import Enum


class EventSessionNextRetriedType(str, Enum):
    SESSION_NEXT_RETRIED = "session.next.retried"

    def __str__(self) -> str:
        return str(self.value)
