from enum import Enum


class LSPStatusStatus(str, Enum):
    CONNECTED = "connected"
    ERROR = "error"

    def __str__(self) -> str:
        return str(self.value)
