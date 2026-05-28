from enum import Enum


class SessionMessageToolStatePendingStatus(str, Enum):
    PENDING = "pending"

    def __str__(self) -> str:
        return str(self.value)
