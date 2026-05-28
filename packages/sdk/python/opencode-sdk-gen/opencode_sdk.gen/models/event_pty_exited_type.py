from enum import Enum


class EventPtyExitedType(str, Enum):
    PTY_EXITED = "pty.exited"

    def __str__(self) -> str:
        return str(self.value)
