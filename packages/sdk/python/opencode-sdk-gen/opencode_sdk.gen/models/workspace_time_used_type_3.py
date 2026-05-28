from enum import Enum


class WorkspaceTimeUsedType3(str, Enum):
    VALUE_0 = "-Infinity"

    def __str__(self) -> str:
        return str(self.value)
