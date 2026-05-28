from enum import Enum


class SyncEventSessionNextSyntheticAggregateID(str, Enum):
    SESSIONID = "sessionID"

    def __str__(self) -> str:
        return str(self.value)
