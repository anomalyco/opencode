from enum import Enum


class EventSessionNextCompactionStartedType(str, Enum):
    SESSION_NEXT_COMPACTION_STARTED = "session.next.compaction.started"

    def __str__(self) -> str:
        return str(self.value)
