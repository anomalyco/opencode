from enum import Enum


class MCPStatusConnectedStatus(str, Enum):
    CONNECTED = "connected"

    def __str__(self) -> str:
        return str(self.value)
