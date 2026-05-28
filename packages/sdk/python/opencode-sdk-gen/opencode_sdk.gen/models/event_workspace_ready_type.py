from enum import Enum


class EventWorkspaceReadyType(str, Enum):
    WORKSPACE_READY = "workspace.ready"

    def __str__(self) -> str:
        return str(self.value)
