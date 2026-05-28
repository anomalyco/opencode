from enum import Enum


class SyncEventSessionNextCompactionEndedName(str, Enum):
    SESSION_NEXT_COMPACTION_ENDED_1 = "session.next.compaction.ended.1"

    def __str__(self) -> str:
        return str(self.value)
