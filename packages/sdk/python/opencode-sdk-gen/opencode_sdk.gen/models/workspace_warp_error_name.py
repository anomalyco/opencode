from enum import Enum


class WorkspaceWarpErrorName(str, Enum):
    WORKSPACEWARPERROR = "WorkspaceWarpError"

    def __str__(self) -> str:
        return str(self.value)
