from enum import Enum


class SyncEventSessionDeletedType(str, Enum):
    SYNC = "sync"

    def __str__(self) -> str:
        return str(self.value)
