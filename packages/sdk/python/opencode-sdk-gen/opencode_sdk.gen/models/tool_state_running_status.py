from enum import Enum


class ToolStateRunningStatus(str, Enum):
    RUNNING = "running"

    def __str__(self) -> str:
        return str(self.value)
