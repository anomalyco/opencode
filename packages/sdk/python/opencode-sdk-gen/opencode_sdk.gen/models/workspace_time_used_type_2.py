from enum import Enum


class WorkspaceTimeUsedType2(str, Enum):
    INFINITY = "Infinity"

    def __str__(self) -> str:
        return str(self.value)
