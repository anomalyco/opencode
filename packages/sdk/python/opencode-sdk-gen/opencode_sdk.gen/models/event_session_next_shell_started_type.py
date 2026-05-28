from enum import Enum


class EventSessionNextShellStartedType(str, Enum):
    SESSION_NEXT_SHELL_STARTED = "session.next.shell.started"

    def __str__(self) -> str:
        return str(self.value)
