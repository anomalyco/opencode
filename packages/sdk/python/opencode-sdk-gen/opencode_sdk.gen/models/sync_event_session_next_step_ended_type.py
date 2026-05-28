from enum import Enum


class SyncEventSessionNextStepEndedType(str, Enum):
    SYNC = "sync"

    def __str__(self) -> str:
        return str(self.value)
