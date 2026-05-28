from enum import Enum


class SyncEventSessionNextToolInputDeltaAggregateID(str, Enum):
    SESSIONID = "sessionID"

    def __str__(self) -> str:
        return str(self.value)
