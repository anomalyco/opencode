from enum import Enum


class EventSessionNextPromptedType(str, Enum):
    SESSION_NEXT_PROMPTED = "session.next.prompted"

    def __str__(self) -> str:
        return str(self.value)
