from enum import Enum


class SyncEventSessionUpdatedName(str, Enum):
    SESSION_UPDATED_1 = "session.updated.1"

    def __str__(self) -> str:
        return str(self.value)
