from enum import Enum


class SyncEventSessionNextReasoningEndedName(str, Enum):
    SESSION_NEXT_REASONING_ENDED_1 = "session.next.reasoning.ended.1"

    def __str__(self) -> str:
        return str(self.value)
