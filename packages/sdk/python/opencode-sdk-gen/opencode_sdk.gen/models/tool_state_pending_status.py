from enum import Enum


class ToolStatePendingStatus(str, Enum):
    PENDING = "pending"

    def __str__(self) -> str:
        return str(self.value)
