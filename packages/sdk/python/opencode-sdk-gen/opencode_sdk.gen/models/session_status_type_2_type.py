from enum import Enum


class SessionStatusType2Type(str, Enum):
    BUSY = "busy"

    def __str__(self) -> str:
        return str(self.value)
