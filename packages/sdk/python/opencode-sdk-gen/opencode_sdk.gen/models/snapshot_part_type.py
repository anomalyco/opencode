from enum import Enum


class SnapshotPartType(str, Enum):
    SNAPSHOT = "snapshot"

    def __str__(self) -> str:
        return str(self.value)
