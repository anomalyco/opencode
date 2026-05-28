from enum import Enum


class SyncEventSessionNextToolCalledAggregateID(str, Enum):
    SESSIONID = "sessionID"

    def __str__(self) -> str:
        return str(self.value)
