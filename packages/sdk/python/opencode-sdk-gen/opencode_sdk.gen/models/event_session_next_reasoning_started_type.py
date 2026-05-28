from enum import Enum


class EventSessionNextReasoningStartedType(str, Enum):
    SESSION_NEXT_REASONING_STARTED = "session.next.reasoning.started"

    def __str__(self) -> str:
        return str(self.value)
