from enum import Enum


class SyncEventSessionNextCompactionStartedName(str, Enum):
    SESSION_NEXT_COMPACTION_STARTED_1 = "session.next.compaction.started.1"

    def __str__(self) -> str:
        return str(self.value)
