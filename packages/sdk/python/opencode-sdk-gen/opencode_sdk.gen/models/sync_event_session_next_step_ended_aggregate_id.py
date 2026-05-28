from enum import Enum


class SyncEventSessionNextStepEndedAggregateID(str, Enum):
    SESSIONID = "sessionID"

    def __str__(self) -> str:
        return str(self.value)
