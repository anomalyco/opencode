from enum import Enum


class EventPtyCreatedType(str, Enum):
    PTY_CREATED = "pty.created"

    def __str__(self) -> str:
        return str(self.value)
