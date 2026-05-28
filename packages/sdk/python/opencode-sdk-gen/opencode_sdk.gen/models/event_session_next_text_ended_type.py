from enum import Enum


class EventSessionNextTextEndedType(str, Enum):
    SESSION_NEXT_TEXT_ENDED = "session.next.text.ended"

    def __str__(self) -> str:
        return str(self.value)
