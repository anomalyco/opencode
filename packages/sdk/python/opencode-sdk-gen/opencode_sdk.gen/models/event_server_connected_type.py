from enum import Enum


class EventServerConnectedType(str, Enum):
    SERVER_CONNECTED = "server.connected"

    def __str__(self) -> str:
        return str(self.value)
