from enum import Enum


class ToolStateCompletedStatus(str, Enum):
    COMPLETED = "completed"

    def __str__(self) -> str:
        return str(self.value)
