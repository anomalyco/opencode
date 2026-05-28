from enum import Enum


class EventSessionNextCompactionEndedType(str, Enum):
    SESSION_NEXT_COMPACTION_ENDED = "session.next.compaction.ended"

    def __str__(self) -> str:
        return str(self.value)
