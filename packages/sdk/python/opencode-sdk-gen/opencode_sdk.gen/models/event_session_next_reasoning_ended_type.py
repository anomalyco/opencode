from enum import Enum


class EventSessionNextReasoningEndedType(str, Enum):
    SESSION_NEXT_REASONING_ENDED = "session.next.reasoning.ended"

    def __str__(self) -> str:
        return str(self.value)
