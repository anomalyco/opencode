from enum import Enum


class EventWorkspaceFailedType(str, Enum):
    WORKSPACE_FAILED = "workspace.failed"

    def __str__(self) -> str:
        return str(self.value)
