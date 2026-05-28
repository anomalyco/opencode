from enum import Enum


class SyncEventSessionNextCompactionDeltaName(str, Enum):
    SESSION_NEXT_COMPACTION_DELTA_1 = "session.next.compaction.delta.1"

    def __str__(self) -> str:
        return str(self.value)
