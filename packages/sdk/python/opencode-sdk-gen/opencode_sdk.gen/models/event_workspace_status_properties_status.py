from enum import Enum


class EventWorkspaceStatusPropertiesStatus(str, Enum):
    CONNECTED = "connected"
    CONNECTING = "connecting"
    DISCONNECTED = "disconnected"
    ERROR = "error"

    def __str__(self) -> str:
        return str(self.value)
