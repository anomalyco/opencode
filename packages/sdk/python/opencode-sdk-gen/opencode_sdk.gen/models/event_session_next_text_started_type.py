from enum import Enum


class EventSessionNextTextStartedType(str, Enum):
    SESSION_NEXT_TEXT_STARTED = "session.next.text.started"

    def __str__(self) -> str:
        return str(self.value)
