from enum import Enum


class CompactionPartType(str, Enum):
    COMPACTION = "compaction"

    def __str__(self) -> str:
        return str(self.value)
