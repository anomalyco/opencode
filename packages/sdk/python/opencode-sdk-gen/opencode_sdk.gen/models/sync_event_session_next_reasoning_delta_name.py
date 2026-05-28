from enum import Enum


class SyncEventSessionNextReasoningDeltaName(str, Enum):
    SESSION_NEXT_REASONING_DELTA_1 = "session.next.reasoning.delta.1"

    def __str__(self) -> str:
        return str(self.value)
