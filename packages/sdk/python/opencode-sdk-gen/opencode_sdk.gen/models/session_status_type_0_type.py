from enum import Enum


class SessionStatusType0Type(str, Enum):
    IDLE = "idle"

    def __str__(self) -> str:
        return str(self.value)
