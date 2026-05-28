from enum import Enum


class SyncEventSessionNextTextDeltaType(str, Enum):
    SYNC = "sync"

    def __str__(self) -> str:
        return str(self.value)
