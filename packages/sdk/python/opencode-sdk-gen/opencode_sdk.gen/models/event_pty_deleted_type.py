from enum import Enum


class EventPtyDeletedType(str, Enum):
    PTY_DELETED = "pty.deleted"

    def __str__(self) -> str:
        return str(self.value)
