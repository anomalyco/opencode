from enum import Enum


class MCPStatusDisabledStatus(str, Enum):
    DISABLED = "disabled"

    def __str__(self) -> str:
        return str(self.value)
