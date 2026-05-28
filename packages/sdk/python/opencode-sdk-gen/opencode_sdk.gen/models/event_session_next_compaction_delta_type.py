from enum import Enum


class EventSessionNextCompactionDeltaType(str, Enum):
    SESSION_NEXT_COMPACTION_DELTA = "session.next.compaction.delta"

    def __str__(self) -> str:
        return str(self.value)
