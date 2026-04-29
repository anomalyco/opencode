from enum import Enum


class PtyStatus(str, Enum):
    EXITED = "exited"
    RUNNING = "running"

    def __str__(self) -> str:
        return str(self.value)
