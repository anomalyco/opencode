from enum import Enum


class EventSessionNextReasoningDeltaType(str, Enum):
    SESSION_NEXT_REASONING_DELTA = "session.next.reasoning.delta"

    def __str__(self) -> str:
        return str(self.value)
