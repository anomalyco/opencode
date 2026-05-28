from enum import Enum


class SessionMessageCompactionType(str, Enum):
    COMPACTION = "compaction"

    def __str__(self) -> str:
        return str(self.value)
