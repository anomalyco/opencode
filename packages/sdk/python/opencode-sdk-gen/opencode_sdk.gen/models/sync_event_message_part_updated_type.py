from enum import Enum


class SyncEventMessagePartUpdatedType(str, Enum):
    SYNC = "sync"

    def __str__(self) -> str:
        return str(self.value)
