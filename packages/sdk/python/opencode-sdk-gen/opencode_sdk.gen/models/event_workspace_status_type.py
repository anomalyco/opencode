from enum import Enum


class EventWorkspaceStatusType(str, Enum):
    WORKSPACE_STATUS = "workspace.status"

    def __str__(self) -> str:
        return str(self.value)
