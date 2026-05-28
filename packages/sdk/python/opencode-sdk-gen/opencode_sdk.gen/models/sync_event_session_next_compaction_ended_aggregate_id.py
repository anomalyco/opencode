from enum import Enum


class SyncEventSessionNextCompactionEndedAggregateID(str, Enum):
    SESSIONID = "sessionID"

    def __str__(self) -> str:
        return str(self.value)
