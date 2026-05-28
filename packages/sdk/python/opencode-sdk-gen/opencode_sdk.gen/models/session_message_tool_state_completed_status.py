from enum import Enum


class SessionMessageToolStateCompletedStatus(str, Enum):
    COMPLETED = "completed"

    def __str__(self) -> str:
        return str(self.value)
