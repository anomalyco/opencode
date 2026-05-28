from enum import Enum


class EventSessionNextTextDeltaType(str, Enum):
    SESSION_NEXT_TEXT_DELTA = "session.next.text.delta"

    def __str__(self) -> str:
        return str(self.value)
