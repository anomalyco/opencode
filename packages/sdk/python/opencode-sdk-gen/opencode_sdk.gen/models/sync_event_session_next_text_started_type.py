from enum import Enum


class SyncEventSessionNextTextStartedType(str, Enum):
    SYNC = "sync"

    def __str__(self) -> str:
        return str(self.value)
