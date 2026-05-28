from enum import Enum


class SyncEventSessionDeletedName(str, Enum):
    SESSION_DELETED_1 = "session.deleted.1"

    def __str__(self) -> str:
        return str(self.value)
