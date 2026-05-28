from enum import Enum


class EventPtyUpdatedType(str, Enum):
    PTY_UPDATED = "pty.updated"

    def __str__(self) -> str:
        return str(self.value)
