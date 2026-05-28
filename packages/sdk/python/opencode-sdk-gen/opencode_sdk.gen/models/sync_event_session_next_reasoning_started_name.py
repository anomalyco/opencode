from enum import Enum


class SyncEventSessionNextReasoningStartedName(str, Enum):
    SESSION_NEXT_REASONING_STARTED_1 = "session.next.reasoning.started.1"

    def __str__(self) -> str:
        return str(self.value)
