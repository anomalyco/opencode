from enum import Enum


class EventSessionNextShellEndedType(str, Enum):
    SESSION_NEXT_SHELL_ENDED = "session.next.shell.ended"

    def __str__(self) -> str:
        return str(self.value)
