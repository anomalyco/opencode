from enum import Enum


class SyncEventSessionNextCompactionDeltaType(str, Enum):
    SYNC = "sync"

    def __str__(self) -> str:
        return str(self.value)
