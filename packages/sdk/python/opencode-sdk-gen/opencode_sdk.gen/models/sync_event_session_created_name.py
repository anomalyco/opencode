from enum import Enum


class SyncEventSessionCreatedName(str, Enum):
    SESSION_CREATED_1 = "session.created.1"

    def __str__(self) -> str:
        return str(self.value)
