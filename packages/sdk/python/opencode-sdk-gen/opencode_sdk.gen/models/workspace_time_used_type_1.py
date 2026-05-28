from enum import Enum


class WorkspaceTimeUsedType1(str, Enum):
    NAN = "NaN"

    def __str__(self) -> str:
        return str(self.value)
