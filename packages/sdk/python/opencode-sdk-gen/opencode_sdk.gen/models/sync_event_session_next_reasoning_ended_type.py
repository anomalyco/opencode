from enum import Enum


class SyncEventSessionNextReasoningEndedType(str, Enum):
    SYNC = "sync"

    def __str__(self) -> str:
        return str(self.value)
